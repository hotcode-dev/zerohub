package handler

import (
	"strings"
	"sync"
	"testing"

	hub "github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
	"go.uber.org/mock/gomock"
)

// TestCreateStaticHubConcurrent proves the handler resolves the create via
// the atomic CreateHubIfAbsent primitive — not a check-then-create dance —
// so N concurrent admin creates of the same static hub ID never orphan a
// hub. The mock returns one shared hub instance for every CreateHubIfAbsent
// call; any racy path (GetHubById followed by an unguarded store) would
// fail the test, because no expectation is set for it.
func TestCreateStaticHubConcurrent(t *testing.T) {
	const hubId = "hot-hub"
	const workers = 200

	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)

	// One real hub instance shared by every goroutine.
	sharedHub, err := hub.NewHub(hubId, `{"name":"test"}`, nil, true)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}

	// Static hubs must be created with isPermanent=true.
	zerohubMock.EXPECT().
		CreateHubIfAbsent(gomock.Any(), gomock.Any(), true).
		Return(sharedHub, nil).
		MaxTimes(workers)

	h := newTestHandler()
	// The cross-mode collision guard probes the random instance before
	// touching the static one; it is empty here.
	randomMock := zerohub.NewMockZeroHub(ctrl)
	randomMock.EXPECT().GetHubById(gomock.Any()).Return(nil).MaxTimes(workers)
	h.zeroHubRandom = randomMock
	h.zeroHubStatic = zerohubMock

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			// A fresh RequestCtx per goroutine, mirroring production where
			// fasthttp serves each request in its own worker.
			ctx := &fasthttp.RequestCtx{}
			ctx.Request.Header.Set("Authorization", adminAuthHeader())
			ctx.Request.SetRequestURI("http://127.0.0.1/v1/static-hubs/create?id=" + hubId + "&hubMetadata=%7B%22name%22%3A%22test%22%7D")

			// Hub creation must succeed. The racy path surfaces as a
			// "create hub error", which is what we guard against
			// specifically.
			if err := h.CreateStaticHub(ctx); err != nil &&
				strings.Contains(err.Error(), "create hub error") {
				t.Errorf("CreateStaticHub = %v, want no create-hub error (racy path taken)", err)
			}
		}()
	}
	wg.Wait()
}

// TestCreateStaticHubAlreadyExists pins the 409 mapping: when
// CreateHubIfAbsent reports the hub already exists, the handler must answer
// 409 Conflict — not 500 — so the losing side of a concurrent create gets
// the documented conflict status.
func TestCreateStaticHubAlreadyExists(t *testing.T) {
	const hubId = "hot-hub"

	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	zerohubMock.EXPECT().
		CreateHubIfAbsent(gomock.Any(), gomock.Any(), true).
		Return(nil, zerohub.ErrHubAlreadyExists).
		MaxTimes(1)

	h := newTestHandler()
	// The cross-mode collision guard probes the random instance before
	// touching the static one; it is empty here.
	randomMock := zerohub.NewMockZeroHub(ctrl)
	randomMock.EXPECT().GetHubById(gomock.Any()).Return(nil).MaxTimes(1)
	h.zeroHubRandom = randomMock
	h.zeroHubStatic = zerohubMock

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Authorization", adminAuthHeader())
	ctx.Request.SetRequestURI("http://127.0.0.1/v1/static-hubs/create?id=" + hubId)

	if err := h.CreateStaticHub(ctx); err != nil {
		t.Fatalf("CreateStaticHub returned unexpected error: %v", err)
	}
	if code := ctx.Response.StatusCode(); code != fasthttp.StatusConflict {
		t.Errorf("status = %d, want %d", code, fasthttp.StatusConflict)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "hub id already exists") {
		t.Errorf("body = %q, want it to contain the already-exists error", body)
	}
}

// TestCreateStaticHubCollidesWithOtherMode pins the cross-mode collision
// guard: when the random instance already holds a hub with the requested
// id, the static create must answer 409 with the collision error instead of
// silently minting a shadow hub in the static namespace.
func TestCreateStaticHubCollidesWithOtherMode(t *testing.T) {
	const hubId = "hot-hub"

	colliding, err := hub.NewHub(hubId, `{"name":"test"}`, nil, false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}

	ctrl := gomock.NewController(t)
	staticMock := zerohub.NewMockZeroHub(ctrl)
	randomMock := zerohub.NewMockZeroHub(ctrl)
	randomMock.EXPECT().GetHubById(hubId).Return(colliding)
	// No CreateHubIfAbsent expectation: the collision must be
	// rejected before the static instance is touched.

	h := newTestHandler()
	h.zeroHubStatic = staticMock
	h.zeroHubRandom = randomMock

	ctx := newRequestCtx("http://127.0.0.1/v1/static-hubs/create?id=" + hubId)
	ctx.Request.Header.Set("Authorization", adminAuthHeader())

	if err := h.CreateStaticHub(ctx); err != nil {
		t.Fatalf("CreateStaticHub returned unexpected error: %v", err)
	}
	if code := ctx.Response.StatusCode(); code != fasthttp.StatusConflict {
		t.Errorf("status = %d, want %d", code, fasthttp.StatusConflict)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "hub id collides with another hub type") {
		t.Errorf("body = %q, want it to contain the collision error", body)
	}
}
