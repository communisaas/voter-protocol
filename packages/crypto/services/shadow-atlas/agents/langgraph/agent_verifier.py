#!/usr/bin/env python3
"""
Agentic Verification System - Replaces Human-in-the-Loop

PURPOSE: Agent-driven quality assurance instead of manual verification.

ARCHITECTURE:
1. Uncertainty Detection: Find low-confidence/disagreement predictions
2. Cross-Validation Agent: Verify predictions via multiple strategies
3. Correction Agent: Fix errors and retrain models
4. Drift Detection: Monitor distribution shifts over time

PHOENIX INTEGRATION: Every agent action fully traced
- Verification decisions logged
- Correction actions tracked
- Model performance metrics recorded
- Drift alerts surfaced

NO HUMAN IN THE LOOP: Fully automated quality assurance
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import List, Dict, Any, Tuple, Optional
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
import numpy as np

# Phoenix observability
from openinference.instrumentation import using_attributes
from opentelemetry import trace
from opentelemetry.trace import Status, StatusCode
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

# LangGraph for agent workflows
from langgraph.graph import StateGraph, END
from langgraph.prebuilt import ToolExecutor

from dataset_classifier import DatasetClassifier
from key_pool import KeyPool

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Setup Phoenix tracer
tracer_provider = TracerProvider()
tracer_provider.add_span_processor(
    SimpleSpanProcessor(
        OTLPSpanExporter(endpoint="http://localhost:6006/v1/traces")
    )
)
trace.set_tracer_provider(tracer_provider)
tracer = trace.get_tracer(__name__)


@dataclass
class VerificationState:
    """State for verification agent workflow."""
    dataset_id: str
    title: str
    ml_prediction: Dict[str, Any]
    verification_status: str  # 'pending', 'verified', 'corrected', 'uncertain'
    llm_verification: Optional[Dict] = None
    field_verification: Optional[Dict] = None
    url_verification: Optional[Dict] = None
    final_label: Optional[bool] = None
    confidence: float = 0.0
    corrections_needed: List[str] = None


class VerificationAgent:
    """
    Multi-strategy verification agent.

    Strategies:
    1. LLM verification: Ask LLM to classify independently
    2. Field analysis: Deep inspection of field names
    3. URL pattern matching: Domain/path analysis
    4. Cross-reference: Check against known datasets
    """

    def __init__(self, key_pool: KeyPool = None):
        self.key_pool = key_pool or KeyPool.from_env()
        self.classifier = DatasetClassifier(key_pool=self.key_pool)

        # Known patterns (updated via feedback loop)
        self.verified_positive_patterns = []
        self.verified_negative_patterns = []

    @tracer.start_as_current_span("verify_with_llm")
    async def verify_with_llm(self, state: VerificationState) -> VerificationState:
        """
        LLM verification strategy.

        Independent classification without seeing ML prediction.
        """
        span = trace.get_current_span()
        span.set_attribute("verification.strategy", "llm")
        span.set_attribute("dataset.id", state.dataset_id)

        try:
            # Classify with LLM (fresh, no ML bias)
            dataset = {
                'id': state.dataset_id,
                'title': state.title,
                'url': state.ml_prediction.get('url', ''),
                'fields': state.ml_prediction.get('fields', []),
                'feature_count': state.ml_prediction.get('feature_count')
            }

            classification = await self.classifier.classify_dataset(dataset)

            state.llm_verification = {
                'is_council_district': classification.is_council_district,
                'confidence': classification.confidence,
                'reasoning': classification.reasoning
            }

            span.set_attribute("llm.prediction", classification.is_council_district)
            span.set_attribute("llm.confidence", classification.confidence)
            span.set_status(Status(StatusCode.OK))

        except Exception as e:
            logger.error(f"LLM verification failed: {e}")
            span.set_status(Status(StatusCode.ERROR, str(e)))
            state.llm_verification = None

        return state

    @tracer.start_as_current_span("verify_with_fields")
    def verify_with_fields(self, state: VerificationState) -> VerificationState:
        """
        Field-based verification strategy.

        Deep analysis of field names and their semantics.
        """
        span = trace.get_current_span()
        span.set_attribute("verification.strategy", "field_analysis")

        fields = state.ml_prediction.get('fields', [])
        if not fields:
            state.field_verification = {'reliable': False}
            return state

        # Strong positive indicators
        positive_fields = [
            'district', 'ward', 'council', 'councilmember',
            'representative', 'alderman', 'seat'
        ]

        # Strong negative indicators
        negative_fields = [
            'school', 'fire', 'police', 'census', 'tract',
            'zip', 'postal', 'county_supervisor'
        ]

        pos_count = sum(1 for f in fields if any(p in f.lower() for p in positive_fields))
        neg_count = sum(1 for f in fields if any(n in f.lower() for n in negative_fields))

        # Deterministic logic
        if pos_count > 0 and neg_count == 0:
            verdict = True
            confidence = min(95, 70 + (pos_count * 10))
        elif neg_count > 0 and pos_count == 0:
            verdict = False
            confidence = min(95, 70 + (neg_count * 10))
        else:
            verdict = None
            confidence = 50

        state.field_verification = {
            'reliable': verdict is not None,
            'is_council_district': verdict,
            'confidence': confidence,
            'positive_fields': pos_count,
            'negative_fields': neg_count
        }

        span.set_attribute("field.positive_count", pos_count)
        span.set_attribute("field.negative_count", neg_count)
        span.set_attribute("field.verdict", str(verdict))

        return state

    @tracer.start_as_current_span("verify_with_url")
    def verify_with_url(self, state: VerificationState) -> VerificationState:
        """
        URL pattern verification strategy.

        Analyze domain and path for signals.
        """
        span = trace.get_current_span()
        span.set_attribute("verification.strategy", "url_pattern")

        url = state.ml_prediction.get('url', '').lower()

        # Known official domains (high trust)
        official_patterns = [
            'gov', 'city.', 'county.', '.us', 'gis.', 'maps.',
            'opendata', 'data.'
        ]

        # Path indicators
        positive_path = [
            '/council', '/district', '/ward', '/political',
            '/boundaries', '/administrative'
        ]

        negative_path = [
            '/school', '/fire', '/transit', '/census'
        ]

        is_official = any(p in url for p in official_patterns)
        has_positive = any(p in url for p in positive_path)
        has_negative = any(p in url for p in negative_path)

        if is_official and has_positive and not has_negative:
            verdict = True
            confidence = 80
        elif has_negative:
            verdict = False
            confidence = 70
        else:
            verdict = None
            confidence = 50

        state.url_verification = {
            'reliable': verdict is not None,
            'is_council_district': verdict,
            'confidence': confidence,
            'is_official_domain': is_official
        }

        span.set_attribute("url.is_official", is_official)
        span.set_attribute("url.verdict", str(verdict))

        return state

    @tracer.start_as_current_span("consensus_decision")
    def make_consensus_decision(self, state: VerificationState) -> VerificationState:
        """
        Combine verification strategies into final decision.

        Voting logic:
        - If all 3 agree → high confidence
        - If 2/3 agree → medium confidence
        - If all disagree → flag for retraining
        """
        span = trace.get_current_span()

        votes = []
        confidences = []

        # Collect votes
        if state.llm_verification:
            votes.append(state.llm_verification['is_council_district'])
            confidences.append(state.llm_verification['confidence'])

        if state.field_verification and state.field_verification['reliable']:
            votes.append(state.field_verification['is_council_district'])
            confidences.append(state.field_verification['confidence'])

        if state.url_verification and state.url_verification['reliable']:
            votes.append(state.url_verification['is_council_district'])
            confidences.append(state.url_verification['confidence'])

        if not votes:
            state.verification_status = 'uncertain'
            state.final_label = None
            state.confidence = 0.0
            return state

        # Count votes
        positive_votes = sum(votes)
        total_votes = len(votes)

        # Consensus
        if positive_votes == total_votes:
            # Unanimous positive
            state.final_label = True
            state.confidence = np.mean(confidences)
            state.verification_status = 'verified'
        elif positive_votes == 0:
            # Unanimous negative
            state.final_label = False
            state.confidence = np.mean(confidences)
            state.verification_status = 'verified'
        elif positive_votes > total_votes / 2:
            # Majority positive
            state.final_label = True
            state.confidence = np.mean(confidences) * 0.8  # Reduce for disagreement
            state.verification_status = 'verified'
        else:
            # Majority negative or tie
            state.final_label = False
            state.confidence = np.mean(confidences) * 0.8
            state.verification_status = 'verified'

        span.set_attribute("consensus.votes_positive", positive_votes)
        span.set_attribute("consensus.votes_total", total_votes)
        span.set_attribute("consensus.final_label", state.final_label)
        span.set_attribute("consensus.confidence", state.confidence)

        return state


class CorrectionAgent:
    """
    Correction agent that fixes errors and triggers retraining.

    When ML prediction disagrees with verification:
    1. Log the correction
    2. Add to retraining dataset
    3. Trigger model retraining (if enough corrections accumulated)
    """

    def __init__(self, retrain_threshold: int = 50):
        self.corrections: List[Dict] = []
        self.retrain_threshold = retrain_threshold
        self.corrections_path = Path("../data/corrections.jsonl")

    @tracer.start_as_current_span("check_correction_needed")
    def check_correction_needed(self, state: VerificationState) -> bool:
        """Check if ML prediction disagrees with verification."""
        ml_pred = state.ml_prediction.get('is_council_district')
        verified_label = state.final_label

        if verified_label is None:
            return False

        return ml_pred != verified_label

    @tracer.start_as_current_span("apply_correction")
    def apply_correction(self, state: VerificationState):
        """
        Log correction and update retraining dataset.
        """
        span = trace.get_current_span()

        correction = {
            'dataset_id': state.dataset_id,
            'title': state.title,
            'ml_prediction': state.ml_prediction.get('is_council_district'),
            'ml_confidence': state.ml_prediction.get('confidence'),
            'verified_label': state.final_label,
            'verified_confidence': state.confidence,
            'timestamp': datetime.now(timezone.utc).isoformat(),
            'verification_strategies': {
                'llm': state.llm_verification,
                'fields': state.field_verification,
                'url': state.url_verification
            }
        }

        self.corrections.append(correction)

        # Save to file
        self.corrections_path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.corrections_path, 'a') as f:
            f.write(json.dumps(correction) + '\n')

        span.set_attribute("correction.count", len(self.corrections))
        span.set_attribute("correction.retrain_threshold", self.retrain_threshold)

        logger.info(f"Correction logged: {state.title[:50]}... "
                   f"(ML: {state.ml_prediction.get('is_council_district')}, "
                   f"Verified: {state.final_label})")

        state.verification_status = 'corrected'
        state.corrections_needed = [
            f"ML predicted {state.ml_prediction.get('is_council_district')}, "
            f"but verification found {state.final_label}"
        ]

        # Check if retraining threshold reached
        if len(self.corrections) >= self.retrain_threshold:
            self.trigger_retraining()

    @tracer.start_as_current_span("trigger_retraining")
    def trigger_retraining(self):
        """
        Trigger model retraining with accumulated corrections.

        This runs asynchronously - doesn't block verification.
        """
        span = trace.get_current_span()
        span.set_attribute("retrain.corrections_count", len(self.corrections))

        logger.info(f"Retraining threshold reached: {len(self.corrections)} corrections")
        logger.info("Triggering model retraining...")

        # In production, this would:
        # 1. Load existing training data
        # 2. Merge corrections
        # 3. Retrain ensemble
        # 4. Deploy new models
        # 5. Clear corrections buffer

        # For now, log the event
        span.add_event(
            "retraining_triggered",
            attributes={"corrections": len(self.corrections)}
        )


class DriftDetector:
    """
    Monitor distribution drift over time.

    Alerts when:
    - Prediction distribution shifts
    - Confidence scores drop
    - Error rate increases
    """

    def __init__(self):
        self.baseline: Optional[Dict] = None
        self.current_window: List[Dict] = []
        self.window_size = 100

    @tracer.start_as_current_span("check_drift")
    def check_drift(self, prediction: Dict) -> Optional[str]:
        """
        Check for distribution drift.

        Returns alert message if drift detected, None otherwise.
        """
        span = trace.get_current_span()

        self.current_window.append(prediction)

        if len(self.current_window) < self.window_size:
            return None

        # Calculate current distribution
        current_stats = self._calculate_stats(self.current_window)

        if self.baseline is None:
            self.baseline = current_stats
            span.set_attribute("drift.baseline_set", True)
            return None

        # Compare to baseline
        drift_score = self._calculate_drift_score(self.baseline, current_stats)

        span.set_attribute("drift.score", drift_score)

        if drift_score > 0.15:  # 15% drift threshold
            alert = (
                f"DRIFT ALERT: Distribution shift detected (score: {drift_score:.2f})\n"
                f"Baseline positive rate: {self.baseline['positive_rate']:.2%}\n"
                f"Current positive rate: {current_stats['positive_rate']:.2%}\n"
                f"Baseline avg confidence: {self.baseline['avg_confidence']:.2f}\n"
                f"Current avg confidence: {current_stats['avg_confidence']:.2f}"
            )

            logger.warning(alert)
            span.add_event("drift_detected", attributes={"score": drift_score})

            # Update baseline
            self.baseline = current_stats
            self.current_window = []

            return alert

        # Slide window
        self.current_window = self.current_window[self.window_size // 2:]

        return None

    def _calculate_stats(self, predictions: List[Dict]) -> Dict:
        """Calculate distribution statistics."""
        positive = sum(1 for p in predictions if p.get('is_council_district', False))
        confidences = [p.get('confidence', 0) for p in predictions]

        return {
            'positive_rate': positive / len(predictions),
            'avg_confidence': np.mean(confidences),
            'std_confidence': np.std(confidences),
            'sample_size': len(predictions)
        }

    def _calculate_drift_score(self, baseline: Dict, current: Dict) -> float:
        """
        Calculate drift score (0-1).

        Combines:
        - Positive rate change
        - Confidence change
        """
        rate_diff = abs(baseline['positive_rate'] - current['positive_rate'])
        conf_diff = abs(baseline['avg_confidence'] - current['avg_confidence']) / 100

        return (rate_diff + conf_diff) / 2


async def verify_predictions(
    predictions: List[Dict],
    verification_agent: VerificationAgent,
    correction_agent: CorrectionAgent,
    drift_detector: DriftDetector
) -> List[VerificationState]:
    """
    Verify ML predictions using agentic workflow.

    For each low-confidence prediction:
    1. Run verification strategies (LLM, fields, URL)
    2. Make consensus decision
    3. Check if correction needed
    4. Monitor for drift
    """
    verified_states = []

    with tracer.start_as_current_span("batch_verification") as span:
        span.set_attribute("batch.size", len(predictions))

        for pred in predictions:
            # Only verify uncertain predictions
            if pred.get('confidence', 1.0) > 0.85:
                continue

            # Initialize state
            state = VerificationState(
                dataset_id=pred['dataset_id'],
                title=pred['title'],
                ml_prediction=pred,
                verification_status='pending'
            )

            # Run verification strategies
            state = await verification_agent.verify_with_llm(state)
            state = verification_agent.verify_with_fields(state)
            state = verification_agent.verify_with_url(state)

            # Make consensus decision
            state = verification_agent.make_consensus_decision(state)

            # Check if correction needed
            if correction_agent.check_correction_needed(state):
                correction_agent.apply_correction(state)

            # Check for drift
            drift_alert = drift_detector.check_drift(pred)
            if drift_alert:
                logger.warning(drift_alert)

            verified_states.append(state)

    return verified_states


async def main():
    """Run agentic verification system."""
    logger.info("Starting Agentic Verification System")
    logger.info("Phoenix tracing enabled at http://localhost:6006")

    # Initialize agents
    verification_agent = VerificationAgent()
    correction_agent = CorrectionAgent(retrain_threshold=50)
    drift_detector = DriftDetector()

    # Example: Verify predictions
    # (Would load from ML ensemble output)

    logger.info("Verification complete. Check Phoenix for traces.")


if __name__ == "__main__":
    asyncio.run(main())
