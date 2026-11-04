package handler

import (
	"strings"
	"sync"
	"testing"

	hub "github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/valyala/fasthttp"
)

// TestCreateStaticHubCollidesWithRandomJoins pins the cross-mode 409 on the
// join-or-create side: when the random instance already holds a hub with the
// requested id, a static create of the same id must answer 409 with the
// collision error — not silently mint a shadow hub in the static namespace.
func TestCreateStaticHubCollidesWithRandomJoins(t *testing.T) {
	const hubId = "collide-hub"

	randomZh := newRealZeroHub(t)
	staticZh := newRealZeroHub(t)
	// Pre-seed the random instance so it owns the id.
	if _, _, err := randomZh.GetOrCreateHub(hubId, `{"name":"seed"}`, false); err != nil {
		t.Fatalf("seed GetOrCreateHub: %v", err)
	}

	h := newTestHandler()
	h.zeroHubStatic = staticZh
	h.zeroHubRandom = randomZh

	ctx := newRequestCtx("http://127.0.0.1/v1/static-hubs/create?id=" + hubId)
	ctx.Request.Header.Set("Authorization", adminAuthHeader())
	if err := h.CreateStaticHub(ctx); err != nil {
		t.Fatalf("CreateStaticHub returned unexpected error: %v", err)
	}
	if code := ctx.Response.StatusCode(); code != fasthttp.StatusConflict {
		t.Errorf("status = %d, want %d", code, fasthttp.StatusConflict)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "hub id collides with another hub type") {
		t.Errorf("body = %q, want the collision error", body)
	}
	// No static hub may have been minted.
	if got := staticZh.GetHubById(hubId); got != nil {
		t.Fatalf("static hub %q was minted despite the cross-mode collision, want none", hubId)
	}
}

// TestCrossModeConcurrentCreateNoFragment is the regression test for the
// TOCTOU race: two concurrent claims of the SAME user-chosen hub id in two
// DIFFERENT hub modes must never leave the id held in both storages — that
// would fragment the room under one public id.
//
// Each goroutine claims through the real claim primitive
// (claimUserChosenHubId) with its own real ZeroHub backing, so the create
// closure stores-and-keeps a hub in its namespace (no upgrade rollback,
// which would otherwise delete the hub and make the invariant vacuous).
//
// Pre-fix, the cross-mode probe was an unlocked read that ran before the
// store: both claims could pass the probe (neither sibling held the id
// yet) and each then stored its own hub under its own instance's lock, so
// the id ended up in both the static and the random storage. The claim now
// holds h.hubIdCrossModeMu across the probe AND the store, so the two
// claims are mutually exclusive across modes: the second to probe sees the
// first's hub and gets a 409 — exactly one namespace holds the id.
func TestCrossModeConcurrentCreateNoFragment(t *testing.T) {
	const hubId = "fragment-hub"
	const rounds = 5

	staticZh := newRealZeroHub(t)
	randomZh := newRealZeroHub(t)
	h := newTestHandler()
	h.zeroHubStatic = staticZh
	h.zeroHubRandom = randomZh

	for round := 0; round < rounds; round++ {
		var wg sync.WaitGroup
		// release lets both claims reach the probe at (nearly) the same
		// instant, so the static-vs-random ordering is not trivially
		// serialized by scheduling alone.
		release := make(chan struct{})

		// Claim in the static namespace: probe the random sibling, then
		// store-and-keep in static under the shared cross-mode lock.
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-release
			ctx := &fasthttp.RequestCtx{}
			_, _, _ = h.claimUserChosenHubId(ctx, hubId, h.siblingInstances(staticZh),
				func() (hub.Hub, error) {
					return staticZh.CreateHubIfAbsent(hubId, "", true)
				})
		}()

		// Claim in the random namespace: probe the static sibling, then
		// store-and-keep in random under the same shared cross-mode lock.
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-release
			ctx := &fasthttp.RequestCtx{}
			_, _, _ = h.claimUserChosenHubId(ctx, hubId, h.siblingInstances(randomZh),
				func() (hub.Hub, error) {
					return randomZh.CreateHubIfAbsent(hubId, "", false)
				})
		}()

		close(release)
		wg.Wait()

		// The invariant: the id must NOT be held in both modes.
		staticHolder := staticZh.GetHubById(hubId)
		randomHolder := randomZh.GetHubById(hubId)
		if staticHolder != nil && randomHolder != nil {
			t.Fatalf("round %d: hub %q held in BOTH the static and the random storage — room fragmented under one public id", round, hubId)
		}
		// And exactly one namespace must own it (neither may lose the race
		// into creating nothing).
		if staticHolder == nil && randomHolder == nil {
			t.Fatalf("round %d: hub %q held in NEITHER storage, want exactly one owner", round, hubId)
		}
	}
}

// TestCrossModeConcurrentCreateStaticWins pins the deterministic winner of a
// static-create vs static-create race (same mode, same id): exactly one
// creates and the rest get 409. This mirrors the existing
// TestCreateStaticHubConcurrent but against a real storage, asserting the
// store-level invariant rather than the mock's absence of racy paths.
func TestCrossModeConcurrentCreateStaticWins(t *testing.T) {
	const hubId = "same-mode-hub"
	const workers = 50

	staticZh := newRealZeroHub(t)
	h := newTestHandler()
	h.zeroHubStatic = staticZh

	var wg sync.WaitGroup
	release := make(chan struct{})
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-release
			ctx := &fasthttp.RequestCtx{}
			ctx.Request.Header.Set("Authorization", adminAuthHeader())
			ctx.Request.SetRequestURI("http://127.0.0.1/v1/static-hubs/create?id=" + hubId)
			_ = h.CreateStaticHub(ctx)
		}()
	}
	close(release)
	wg.Wait()

	// Exactly one hub may exist under the id (same-mode creates collapse to
	// one hub via CreateHubIfAbsent).
	if got := staticZh.GetHubById(hubId); got == nil {
		t.Fatalf("no static hub under %q after %d concurrent creates, want exactly one", hubId, workers)
	}
}
