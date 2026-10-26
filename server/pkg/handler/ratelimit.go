package handler

import (
	"sync"
	"time"

	"github.com/valyala/fasthttp"
)

const (
	// rateLimitCapacity is the per-key token budget: 60 requests per
	// minute, matching the "60-M" rate of the previous limiter.
	rateLimitCapacity = 60
	// rateLimitPeriod is how long it takes a key's budget to refill from
	// empty to full.
	rateLimitPeriod = time.Minute
	// rateLimitIdleTTL is how long a key may sit without a request before
	// its per-key entry is reclaimed, so the map cannot grow without
	// bound on a long-running server facing many distinct clients.
	rateLimitIdleTTL = 2 * time.Minute
	// rateLimitSweepEvery bounds how often the idle sweep walks the map;
	// the sweep only runs once the last one is this old, so a busy
	// limiter pays for it at most every 32s.
	rateLimitSweepEvery = 32 * time.Second
)

// rateLimiter is a mutex-guarded token bucket with one budget per key
// string. Refill is continuous (rateLimitCapacity tokens over
// rateLimitPeriod), entries are capped at the full budget, and keys idle
// for longer than rateLimitIdleTTL are reclaimed by a periodic sweep.
type rateLimiter struct {
	mu        sync.Mutex
	buckets   map[string]*rateBucket
	lastSweep time.Time
}

// rateBucket is the per-key token-bucket state.
type rateBucket struct {
	tokens   float64
	lastUsed time.Time
}

// newRateLimiter returns a limiter allowing rateLimitCapacity requests per
// key per rateLimitPeriod.
func newRateLimiter() *rateLimiter {
	return &rateLimiter{buckets: make(map[string]*rateBucket)}
}

// allow reports whether a request for key should be allowed and records it
// against the key's budget.
func (r *rateLimiter) allow(key string, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()

	if now.Sub(r.lastSweep) >= rateLimitSweepEvery {
		r.sweepLocked(now)
	}

	bucket, ok := r.buckets[key]
	if !ok {
		// New key: start from a full budget and consume the first token.
		r.buckets[key] = &rateBucket{tokens: float64(rateLimitCapacity) - 1, lastUsed: now}
		return true
	}

	// Reclaim keys whose last request is long enough in the past that they
	// have been drained (an idle bucket holds no usable tokens, so deleting
	// it cannot affect their next request).
	if now.Sub(bucket.lastUsed) >= rateLimitPeriod {
		delete(r.buckets, key)
		r.buckets[key] = &rateBucket{tokens: float64(rateLimitCapacity) - 1, lastUsed: now}
		return true
	}

	// Refill continuously: capacity tokens over the period.
	bucket.tokens += now.Sub(bucket.lastUsed).Seconds() / rateLimitPeriod.Seconds() * float64(rateLimitCapacity)
	if bucket.tokens > rateLimitCapacity {
		bucket.tokens = rateLimitCapacity
	}
	bucket.lastUsed = now

	if bucket.tokens < 1 {
		return false
	}
	bucket.tokens--
	return true
}

// sweepLocked deletes keys with no request for longer than
// rateLimitIdleTTL. Callers must hold r.mu.
func (r *rateLimiter) sweepLocked(now time.Time) {
	r.lastSweep = now
	for key, bucket := range r.buckets {
		if now.Sub(bucket.lastUsed) > rateLimitIdleTTL {
			delete(r.buckets, key)
		}
	}
}

// len reports the number of keys currently tracked.
func (r *rateLimiter) len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.buckets)
}

// rateLimitMiddleware wraps a fasthttp handler with per-key rate limiting.
// The key getter selects the per-client identity: the socket peer address
// by default, or the trusted proxy's X-Forwarded-For value when trustProxy
// is set.
type rateLimitMiddleware struct {
	limiter   *rateLimiter
	keyGetter func(ctx *fasthttp.RequestCtx) string
}

// newRateLimitMiddleware builds the rate-limit middleware for Serve.
//
// By default the limiter is keyed by the TCP socket peer address, which a
// client cannot spoof. When trustProxy is set (the server sits behind a
// reverse proxy that strips or replaces the X-Forwarded-For and X-Real-IP
// headers), the limiter instead keys by the sanitized X-Forwarded-For
// value, which identifies the real client. Never enable trustProxy in
// front of an untrusted hop: any client could then forge a fresh "IP" per
// request and defeat the per-client DoS throttle.
func newRateLimitMiddleware(trustProxy bool) (*rateLimitMiddleware, error) {
	keyGetter := remoteAddrKey
	if trustProxy {
		keyGetter = forwardedIPKey
	}
	return &rateLimitMiddleware{limiter: newRateLimiter(), keyGetter: keyGetter}, nil
}

// Handle wraps next with rate limiting: requests that exceed the key's
// budget are answered with 429 and never reach next; allowed requests pass
// through unchanged.
func (m *rateLimitMiddleware) Handle(next fasthttp.RequestHandler) fasthttp.RequestHandler {
	return func(ctx *fasthttp.RequestCtx) {
		if !m.limiter.allow(m.keyGetter(ctx), time.Now()) {
			ctx.Error("rate limit exceeded", fasthttp.StatusTooManyRequests)
			return
		}
		next(ctx)
	}
}
