#!/usr/bin/env python3
"""
Generate visual dashboard for statistical validation results

Creates ASCII/Unicode charts for terminal display
"""

import json
from pathlib import Path
from typing import Dict, List


def load_report(path: str) -> Dict:
    """Load statistical report JSON"""
    with open(path, 'r') as f:
        return json.load(f)


def create_bar_chart(data: Dict[str, float], width: int = 50, label: str = "") -> str:
    """Create horizontal bar chart"""
    output = []

    if label:
        output.append(label)
        output.append("-" * width)

    max_val = max(data.values())

    for key, value in sorted(data.items(), key=lambda x: -x[1]):
        bar_len = int((value / max_val) * width) if max_val > 0 else 0
        bar = "█" * bar_len
        pct = (value / sum(data.values())) * 100 if sum(data.values()) > 0 else 0
        output.append(f"{key:20s} {bar:50s} {value:6.0f} ({pct:5.1f}%)")

    return "\n".join(output)


def create_histogram(values: List[float], bins: int = 10, width: int = 50, label: str = "") -> str:
    """Create histogram"""
    output = []

    if label:
        output.append(label)
        output.append("-" * width)

    # Create bins
    min_val = min(values)
    max_val = max(values)
    bin_width = (max_val - min_val) / bins

    bin_counts = [0] * bins
    for val in values:
        bin_idx = min(int((val - min_val) / bin_width), bins - 1)
        bin_counts[bin_idx] += 1

    max_count = max(bin_counts)

    # Draw histogram
    for i, count in enumerate(bin_counts):
        bin_start = min_val + i * bin_width
        bin_end = bin_start + bin_width
        bar_len = int((count / max_count) * width) if max_count > 0 else 0
        bar = "█" * bar_len
        output.append(f"{bin_start:5.2f}-{bin_end:5.2f} {bar:50s} {count:3d}")

    return "\n".join(output)


def create_kappa_matrix(kappa_data: Dict, width: int = 80) -> str:
    """Create formatted Kappa matrix with color coding"""
    output = []

    methods = list(kappa_data.keys())
    output.append("Cohen's Kappa Matrix (Inter-Method Agreement)")
    output.append("=" * width)
    output.append("")

    # Header
    header = "Method".ljust(20)
    for method in methods:
        header += f" {method[:10]:>10s}"
    output.append(header)
    output.append("-" * width)

    # Rows
    for method1 in methods:
        row = f"{method1[:20]:20s}"
        for method2 in methods:
            kappa = kappa_data[method1][method2]

            # Color coding (ASCII approximation)
            if kappa >= 0.81:
                symbol = "+++"  # Almost perfect
            elif kappa >= 0.61:
                symbol = "++"   # Substantial
            elif kappa >= 0.41:
                symbol = "+"    # Moderate
            elif kappa >= 0.21:
                symbol = "~"    # Fair
            elif kappa >= 0.0:
                symbol = "-"    # Slight
            else:
                symbol = "--"   # Poor

            row += f" {kappa:>9.3f}{symbol[0]}"
        output.append(row)

    output.append("")
    output.append("Legend: +++ (0.81-1.0 Excellent), ++ (0.61-0.80 Good), + (0.41-0.60 OK)")
    output.append("        ~ (0.21-0.40 Fair/Weak), - (0.0-0.20 Slight), -- (<0.0 Poor)")

    return "\n".join(output)


def create_risk_pie_chart(contamination: Dict, width: int = 60) -> str:
    """Create ASCII pie chart for risk distribution"""
    output = []

    low = contamination['low_risk']
    medium = contamination['medium_risk']
    high = contamination['high_risk']
    total = low + medium + high

    low_pct = (low / total) * 100
    med_pct = (medium / total) * 100
    high_pct = (high / total) * 100

    output.append("Risk Distribution")
    output.append("=" * width)
    output.append("")

    # ASCII pie approximation (horizontal bars)
    bar_chars = width - 2
    low_chars = int((low_pct / 100) * bar_chars)
    med_chars = int((med_pct / 100) * bar_chars)
    high_chars = bar_chars - low_chars - med_chars

    output.append("█" * low_chars + "▓" * med_chars + "░" * high_chars)
    output.append("")
    output.append(f"█ LOW risk:    {low:3d} samples ({low_pct:5.1f}%) - ACCEPT")
    output.append(f"▓ MEDIUM risk: {medium:3d} samples ({med_pct:5.1f}%) - VERIFY")
    output.append(f"░ HIGH risk:   {high:3d} samples ({high_pct:5.1f}%) - MANUAL REVIEW")
    output.append("")
    output.append(f"Estimated Contamination: {contamination['estimated_contamination_rate']*100:.2f}%")
    output.append(f"95% Confidence Interval: [{contamination['confidence_interval_95'][0]*100:.2f}%, "
                  f"{contamination['confidence_interval_95'][1]*100:.2f}%]")

    return "\n".join(output)


def create_dashboard(report_path: str) -> str:
    """Generate complete dashboard"""
    report = load_report(report_path)

    output = []

    # Header
    output.append("=" * 80)
    output.append("STATISTICAL DATA QUALITY ASSURANCE DASHBOARD")
    output.append("=" * 80)
    output.append("")

    # 1. Overview
    overview = report['overview']
    output.append("1. DATASET OVERVIEW")
    output.append("-" * 80)
    output.append(f"Total samples:     {overview['total_samples']}")
    output.append(f"TRUE labels:       {overview['llm_true_labels']} ({overview['llm_true_labels']/overview['total_samples']*100:.1f}%)")
    output.append(f"FALSE labels:      {overview['llm_false_labels']} ({overview['llm_false_labels']/overview['total_samples']*100:.1f}%)")
    output.append(f"Class balance:     {overview['class_balance']}")
    output.append("")

    # 2. Risk Distribution (Visual)
    output.append("2. CONTAMINATION RISK ANALYSIS")
    output.append("-" * 80)
    output.append(create_risk_pie_chart(report['contamination'], width=80))
    output.append("")

    # 3. Recommended Actions
    output.append("3. RECOMMENDED ACTIONS")
    output.append("-" * 80)
    actions = report['recommended_actions']
    output.append(create_bar_chart(
        {
            "ACCEPT": actions['accept'],
            "VERIFY": actions['verify'],
            "MANUAL_REVIEW": actions['manual_review']
        },
        width=50,
        label=""
    ))
    output.append("")

    # 4. Inter-Method Agreement
    output.append("4. INTER-METHOD AGREEMENT")
    output.append("-" * 80)
    output.append(create_kappa_matrix(report['cohen_kappa'], width=80))
    output.append("")

    # Calculate average kappa (excluding diagonal)
    kappas = []
    for m1, values in report['cohen_kappa'].items():
        for m2, kappa in values.items():
            if m1 != m2 and kappa != 0.0:  # Exclude self and missing values
                kappas.append(kappa)

    avg_kappa = sum(kappas) / len(kappas) if kappas else 0
    output.append(f"Average Inter-Method Kappa: {avg_kappa:.3f}")

    if avg_kappa >= 0.61:
        output.append("Interpretation: SUBSTANTIAL agreement (Good)")
    elif avg_kappa >= 0.41:
        output.append("Interpretation: MODERATE agreement (Acceptable)")
    elif avg_kappa >= 0.21:
        output.append("Interpretation: FAIR agreement (CONCERN)")
    else:
        output.append("Interpretation: SLIGHT agreement (CRITICAL ISSUE)")
    output.append("")

    # 5. Statistical Tests
    output.append("5. HYPOTHESIS TEST RESULTS")
    output.append("-" * 80)

    tests = report['hypothesis_tests']

    output.append("Test 1: Label Distribution Balance")
    output.append(f"  χ² statistic: {tests['label_distribution']['chi2_statistic']:.4f}")
    output.append(f"  p-value:      {tests['label_distribution']['p_value']:.4f}")
    output.append(f"  Result:       {tests['label_distribution']['interpretation']}")
    output.append("")

    output.append("Test 2: Agreement vs Random Chance")
    output.append(f"  Mean agreement: {tests['agreement_test']['mean_agreement']:.4f}")
    output.append(f"  t-statistic:    {tests['agreement_test']['t_statistic']:.4f}")
    output.append(f"  p-value:        {tests['agreement_test']['p_value']:.2e}")
    output.append(f"  Result:         {tests['agreement_test']['interpretation']}")
    output.append("")

    output.append("Test 3: Confidence-Consistency Correlation")
    output.append(f"  High confidence mean: {tests['confidence_consistency']['high_conf_mean']:.4f}")
    output.append(f"  Low confidence mean:  {tests['confidence_consistency']['low_conf_mean']:.4f}")
    output.append(f"  t-statistic:          {tests['confidence_consistency']['t_statistic']:.4f}")
    output.append(f"  p-value:              {tests['confidence_consistency']['p_value']:.2e}")
    output.append(f"  Result:               {tests['confidence_consistency']['interpretation']}")
    output.append("")

    # 6. Key Metrics
    output.append("6. QUALITY METRICS SCORECARD")
    output.append("-" * 80)

    metrics = [
        ("Contamination Rate", f"{report['contamination']['estimated_contamination_rate']*100:.1f}%", "<5%",
         "❌" if report['contamination']['estimated_contamination_rate'] > 0.05 else "✅"),
        ("Inter-Method Kappa", f"{avg_kappa:.3f}", ">0.6",
         "❌" if avg_kappa < 0.6 else "✅"),
        ("Agreement Mean", f"{report['agreement_distribution']['mean']:.3f}", ">0.85",
         "✅" if report['agreement_distribution']['mean'] > 0.85 else "❌"),
        ("Disagreement Rate", f"{report['disagreements']['disagreement_rate']*100:.1f}%", "<5%",
         "⚠️" if report['disagreements']['disagreement_rate'] > 0.05 else "✅"),
        ("Outlier Rate", f"{report['outliers']['outlier_rate']*100:.1f}%", "<10%",
         "⚠️" if report['outliers']['outlier_rate'] > 0.10 else "✅"),
    ]

    output.append(f"{'Metric':<25} {'Value':<15} {'Target':<10} {'Status':<6}")
    output.append("-" * 80)
    for metric, value, target, status in metrics:
        output.append(f"{metric:<25} {value:<15} {target:<10} {status:<6}")

    output.append("")

    # 7. Action Summary
    output.append("7. IMMEDIATE NEXT STEPS")
    output.append("-" * 80)
    output.append(f"⚠️  PRIORITY 0: Manual review {report['contamination']['high_risk']} HIGH risk samples (2-3 hours)")
    output.append(f"⚠️  PRIORITY 1: Spot-check {report['contamination']['medium_risk']} MEDIUM risk samples (1 hour)")
    output.append(f"ℹ️  PRIORITY 2: Investigate {report['disagreements']['n_disagreements']} disagreements for patterns (1 hour)")
    output.append("")
    output.append("📁 Files generated:")
    output.append("   - validation_results/high_risk_samples.json")
    output.append("   - validation_results/disagreements.json")
    output.append("   - validation_results/sample_analysis.csv")
    output.append("")

    # Footer
    output.append("=" * 80)
    output.append("VERDICT: Dataset requires manual review before production deployment")
    output.append("=" * 80)

    return "\n".join(output)


def main():
    """Generate and print dashboard"""
    report_path = "/Users/noot/Documents/voter-protocol/packages/crypto/services/shadow-atlas/agents/langgraph/validation_results/statistical_report.json"

    dashboard = create_dashboard(report_path)
    print(dashboard)

    # Save to file
    output_path = Path(report_path).parent / "dashboard.txt"
    with open(output_path, 'w') as f:
        f.write(dashboard)

    print(f"\n\nDashboard saved to: {output_path}")


if __name__ == "__main__":
    main()
