package handler

import (
	"sync"
	"testing"
	"time"
)

// TestRateLimiterIdleKeyEviction verifies that keys with no request for
// longer than rateLimitIdleTTL are reclaimed by the sweep, so the per-key
// map cannot grow without bound for a long-running server facing many
// distinct client keys.
func TestRateLimiterIdleKeyEviction(t *testing.T) {
	r := newRateLimiter()
	now := time.Now()

	const keys = 100
	for i := 0; i < keys; i++ {
		// Each key gets one request, so every key starts with an almost-full
		// budget and a lastUsed of `now`.
		key := "idle-key-" + string(rune('A'+i%26)) + string(rune('0'+i/26))
		if !r.allow(key, now) {
			t.Fatalf("request %d: want allowed, got 429", i)
		}
	}
	if got := r.len(); got != keys {
		t.Fatalf("len after seeding = %d, want %d", got, keys)
	}

	// No request for the idle TTL: the keys are now evictable. A single
	// request for a live key forces a sweep (the last sweep is far in the
	// past); the live key stays and the idle keys are removed.
	evictedAt := now.Add(rateLimitIdleTTL + time.Second)
	if !r.allow("live-key", evictedAt) {
		t.Fatal("live-key request after eviction: want allowed, got 429")
	}
	if got := r.len(); got != 1 {
		t.Fatalf("len after idle sweep = %d, want 1 (only live-key remains)", got)
	}
}

// TestRateLimiterSweepThrottle guards the sweep throttle: the idle sweep
// runs at most once per rateLimitSweepEvery, so an evictable key must
// survive a request that lands inside the throttle window and be reclaimed
// by the next request that falls outside it. Without the throttle the
// sweep would walk the whole map on every request.
func TestRateLimiterSweepThrottle(t *testing.T) {
	r := newRateLimiter()
	t0 := time.Now()

	// "old" is seeded now; the first allow runs a sweep (lastSweep was the
	// zero time) and sets lastSweep = t0.
	if !r.allow("old", t0) {
		t.Fatal("seed request: want allowed")
	}

	// 115s later: the sweep throttle has elapsed (115s > 32s), so a sweep
	// runs — but "old" has only been idle 115s (< rateLimitIdleTTL), so it
	// survives.
	t1 := t0.Add(115 * time.Second)
	if !r.allow("fresh", t1) {
		t.Fatal("t1 request: want allowed")
	}
	if got := r.len(); got != 2 {
		t.Fatalf("len at t1 = %d, want 2 (old not yet idle-long-enough)", got)
	}

	// 15s later (still inside the 32s throttle window): "old" is now idle
	// 130s (> rateLimitIdleTTL) but the sweep is suppressed, so it must
	// still be present.
	t2 := t1.Add(15 * time.Second)
	if !r.allow("fresh", t2) {
		t.Fatal("t2 request: want allowed")
	}
	if got := r.len(); got != 2 {
		t.Fatalf("len at t2 = %d, want 2 (sweep throttled within %s of last sweep)", got, rateLimitSweepEvery)
	}

	// 33s after t1: the throttle has elapsed, the sweep runs and "old" is
	// finally reclaimed.
	t3 := t1.Add(33 * time.Second)
	if !r.allow("fresh", t3) {
		t.Fatal("t3 request: want allowed")
	}
	if got := r.len(); got != 1 {
		t.Fatalf("len at t3 = %d, want 1 (old reclaimed by the sweep)", got)
	}
}

// TestRateLimiterIndependentBuckets verifies that distinct keys have
// independent budgets: one key exhausting its budget must not affect
// another key's requests.
func TestRateLimiterIndependentBuckets(t *testing.T) {
	r := newRateLimiter()
	now := time.Now()

	// Exhaust key A's full 60-token budget at a single instant.
	var ok, limited int
	for i := 0; i < rateLimitCapacity+1; i++ {
		if r.allow("A", now) {
			ok++
		} else {
			limited++
		}
	}
	if ok != rateLimitCapacity || limited != 1 {
		t.Fatalf("key A: ok=%d limited=%d, want ok=%d limited=1", ok, limited, rateLimitCapacity)
	}

	// Key B is completely unaffected.
	if !r.allow("B", now) {
		t.Fatal("key B: want allowed while A is exhausted")
	}
}

// TestRateLimiterRefillAcrossTime verifies that a drained key regains
// tokens as time passes at the continuous refill rate: after half a period
// exactly half the budget is available.
func TestRateLimiterRefillAcrossTime(t *testing.T) {
	r := newRateLimiter()
	now := time.Now()

	// Drain the full budget at a single instant.
	for i := 0; i < rateLimitCapacity; i++ {
		if !r.allow("A", now) {
			t.Fatalf("request %d: want allowed while budget lasts", i)
		}
	}
	if r.allow("A", now) {
		t.Fatalf("request %d: want 429 after exhausting the budget", rateLimitCapacity)
	}

	// Half a period later: exactly half the budget has refilled.
	half := now.Add(rateLimitPeriod / 2)
	for i := 0; i < rateLimitCapacity/2; i++ {
		if !r.allow("A", half) {
			t.Fatalf("request %d after half-period refill: want allowed", i)
		}
	}
	if r.allow("A", half) {
		t.Fatal("request after refilled half-budget: want 429")
	}
}

// TestRateLimiterConcurrentAllow hammers one shared key and one key per
// goroutine from many goroutines to confirm the map and budget accounting
// are safe under concurrent access (this host cannot run -race; see the
// precommit note).
func TestRateLimiterConcurrentAllow(t *testing.T) {
	r := newRateLimiter()
	now := time.Now()

	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < 500; i++ {
				_ = r.allow("shared", now.Add(time.Duration(i)*time.Millisecond))
				_ = r.allow("key-"+string(rune('0'+g)), now.Add(time.Duration(i)*time.Millisecond))
			}
		}(g)
	}
	wg.Wait()

	if got := r.len(); got != 9 {
		t.Fatalf("len after concurrent allows = %d, want 9 (shared + 8 per-goroutine keys)", got)
	}
}
