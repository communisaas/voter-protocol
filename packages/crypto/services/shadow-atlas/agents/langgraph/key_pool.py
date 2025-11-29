"""
Multi-Project API Key Pool with Rate Limit Awareness

Key insight: Gemini rate limits are per-PROJECT, not per-key.
Multiple keys in the same project share quota.
Real scaling requires keys from different projects.

Free tier: 10 RPM, 500 RPD per project
With 3 free projects: 30 RPM, 1500 RPD effective capacity
"""

import asyncio
import os
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional
import logging

logger = logging.getLogger(__name__)


class Tier(Enum):
    FREE = "free"
    TIER1 = "tier1"
    TIER2 = "tier2"
    TIER3 = "tier3"


# Rate limits by tier (requests per minute/day)
TIER_LIMITS = {
    Tier.FREE: {"rpm": 10, "rpd": 500},
    Tier.TIER1: {"rpm": 1000, "rpd": 10000},
    Tier.TIER2: {"rpm": 2000, "rpd": 20000},
    Tier.TIER3: {"rpm": 3000, "rpd": 100000},
}


@dataclass
class KeyConfig:
    """Configuration for a single API key"""
    key: str
    project_id: str
    tier: Tier = Tier.FREE
    label: Optional[str] = None


@dataclass
class KeyState:
    """Runtime state for a key"""
    config: KeyConfig
    rate_limited_until: float = 0.0
    error_count: int = 0
    request_count: int = 0
    minute_count: int = 0
    last_minute_reset: float = field(default_factory=time.time)
    last_daily_reset: float = field(default_factory=time.time)


class AllKeysExhaustedError(Exception):
    """Raised when all keys are rate limited"""
    def __init__(self, soonest_retry_ms: float):
        self.soonest_retry_ms = soonest_retry_ms
        super().__init__(
            f"All API keys rate limited. Soonest retry: {soonest_retry_ms/1000:.1f}s"
        )


class KeyPool:
    """
    Thread-safe key pool with rate limit awareness.

    Usage:
        pool = KeyPool.from_env()
        async with pool.acquire() as key_info:
            # Use key_info.key for API call
            response = await call_gemini(key_info.key, ...)
    """

    def __init__(self, configs: list[KeyConfig]):
        if not configs:
            raise ValueError("At least one API key required")

        self._keys = [KeyState(config=c) for c in configs]
        self._current_index = 0
        self._lock = asyncio.Lock()

        logger.info(
            f"KeyPool initialized with {len(configs)} keys across "
            f"{len(set(c.project_id for c in configs))} projects"
        )

    @classmethod
    def from_env(cls, env_var: str = "GEMINI_KEYS") -> "KeyPool":
        """
        Create key pool from environment variable.

        Format: project1:key1:tier1,project2:key2:free,project3:key3
        Tier is optional, defaults to 'free'
        """
        keys_string = os.environ.get(env_var)
        if not keys_string:
            raise ValueError(f"Environment variable {env_var} not set")

        configs = []
        for i, entry in enumerate(keys_string.split(",")):
            parts = entry.strip().split(":")
            if len(parts) < 2:
                raise ValueError(
                    f"Invalid key format at index {i}: expected 'projectId:key[:tier]'"
                )

            project_id, key = parts[0], parts[1]
            tier_str = parts[2] if len(parts) > 2 else "free"

            try:
                tier = Tier(tier_str.lower())
            except ValueError:
                raise ValueError(f"Invalid tier '{tier_str}' at index {i}")

            configs.append(KeyConfig(
                key=key,
                project_id=project_id,
                tier=tier,
                label=f"key-{i+1}"
            ))

        return cls(configs)

    async def acquire(self) -> "KeyContext":
        """Acquire a key for use. Returns a context manager."""
        return KeyContext(self)

    async def _get_next_key(self) -> KeyState:
        """Get next available key using round-robin with rate limit awareness"""
        async with self._lock:
            now = time.time()
            self._reset_counters_if_needed(now)

            # Try to find an available key
            for i in range(len(self._keys)):
                idx = (self._current_index + i) % len(self._keys)
                key_state = self._keys[idx]
                limits = TIER_LIMITS[key_state.config.tier]

                # Skip if rate limited
                if key_state.rate_limited_until > now:
                    continue

                # Skip if at daily limit
                if key_state.request_count >= limits["rpd"]:
                    continue

                # Skip if at minute limit
                if key_state.minute_count >= limits["rpm"]:
                    continue

                # Found available key
                self._current_index = (idx + 1) % len(self._keys)
                key_state.request_count += 1
                key_state.minute_count += 1

                return key_state

            # All keys exhausted - calculate soonest retry
            soonest = self._calculate_soonest_retry(now)
            raise AllKeysExhaustedError(soonest * 1000)

    def _reset_counters_if_needed(self, now: float):
        """Reset minute and daily counters as needed"""
        for key_state in self._keys:
            # Reset minute counter every 60 seconds
            if now - key_state.last_minute_reset >= 60:
                key_state.minute_count = 0
                key_state.last_minute_reset = now

            # Reset daily counter at UTC midnight
            from datetime import datetime, timezone
            midnight = datetime.now(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            ).timestamp()

            if key_state.last_daily_reset < midnight:
                key_state.request_count = 0
                key_state.last_daily_reset = now

    def _calculate_soonest_retry(self, now: float) -> float:
        """Calculate seconds until soonest key becomes available"""
        soonest = float('inf')

        for key_state in self._keys:
            limits = TIER_LIMITS[key_state.config.tier]

            # If rate limited, check when it expires
            if key_state.rate_limited_until > now:
                wait = key_state.rate_limited_until - now
                soonest = min(soonest, wait)
                continue

            # If at minute limit, wait for reset
            if key_state.minute_count >= limits["rpm"]:
                wait = 60 - (now - key_state.last_minute_reset)
                soonest = min(soonest, max(0, wait))
                continue

            # If at daily limit, wait for midnight
            from datetime import datetime, timezone
            tomorrow = datetime.now(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            tomorrow = tomorrow.timestamp() + 86400
            soonest = min(soonest, tomorrow - now)

        return soonest if soonest != float('inf') else 60.0

    async def mark_rate_limited(self, key: str, retry_after_s: float = 60.0):
        """Mark a key as rate limited"""
        async with self._lock:
            for key_state in self._keys:
                if key_state.config.key == key:
                    key_state.rate_limited_until = time.time() + retry_after_s
                    key_state.error_count += 1
                    logger.warning(
                        f"Key {key_state.config.label or key_state.config.project_id} "
                        f"rate limited for {retry_after_s:.1f}s "
                        f"(errors: {key_state.error_count})"
                    )
                    break

    async def mark_success(self, key: str):
        """Mark a successful request (reset error count)"""
        async with self._lock:
            for key_state in self._keys:
                if key_state.config.key == key:
                    key_state.error_count = 0
                    break

    def get_status(self) -> dict:
        """Get current status of all keys"""
        now = time.time()

        key_statuses = []
        for ks in self._keys:
            limits = TIER_LIMITS[ks.config.tier]
            available = (
                ks.rate_limited_until <= now and
                ks.request_count < limits["rpd"] and
                ks.minute_count < limits["rpm"]
            )

            key_statuses.append({
                "project_id": ks.config.project_id,
                "tier": ks.config.tier.value,
                "available": available,
                "requests_today": ks.request_count,
                "daily_limit": limits["rpd"],
                "requests_this_minute": ks.minute_count,
                "minute_limit": limits["rpm"],
                "rate_limited_until": ks.rate_limited_until if ks.rate_limited_until > now else None,
            })

        return {
            "total_keys": len(self._keys),
            "available_keys": sum(1 for k in key_statuses if k["available"]),
            "rate_limited_keys": sum(1 for k in key_statuses if not k["available"]),
            "total_requests_today": sum(k["requests_today"] for k in key_statuses),
            "keys": key_statuses,
        }


class KeyContext:
    """Context manager for key acquisition"""

    def __init__(self, pool: KeyPool):
        self._pool = pool
        self._key_state: Optional[KeyState] = None

    async def __aenter__(self) -> "KeyInfo":
        self._key_state = await self._pool._get_next_key()
        return KeyInfo(
            key=self._key_state.config.key,
            project_id=self._key_state.config.project_id,
            tier=self._key_state.config.tier,
        )

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None and self._key_state:
            # Check if it was a rate limit error
            if "429" in str(exc_val) or "quota" in str(exc_val).lower():
                await self._pool.mark_rate_limited(self._key_state.config.key)
        elif self._key_state:
            await self._pool.mark_success(self._key_state.config.key)
        return False  # Don't suppress exceptions


@dataclass
class KeyInfo:
    """Information about an acquired key"""
    key: str
    project_id: str
    tier: Tier
