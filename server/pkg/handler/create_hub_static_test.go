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

// TestCreateHubStaticConcurrent proves the handler resolves the create via
// the atomic CreateHubIfAbsent primitive — not the old
// GetHubById-then-NewHub dance — so N concurrent create requests for the
// same static ID never orphan a hub. Before the fix, two requests
// interleaving at the "does the hub exist?" check would each call NewHub and
// the second Add would silently overwrite the first, splitting the room.
//
// The mock returns one shared hub instance for every CreateHubIfAbsent
// call. Any call to GetHubById or NewHub (the racy path) would fail the
// test, because no expectation is set for them.
func TestCreateHubStaticConcurrent(t *testing.T) {
	const hubId = "hot-hub"
	const workers = 200

	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)

	// One real hub instance shared by every goroutine.
	sharedHub, err := hub.NewHub(hubId, `{"name":"test"}`, nil, false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}

	// CreateHubIfAbsent is the ONLY hub-resolution call the handler may make.
	zerohubMock.EXPECT().
		CreateHubIfAbsent(gomock.Any(), gomock.Any(), false).
		Return(sharedHub, nil).
		MaxTimes(workers)

	// The websocket handshake fails for a plain GET, so CreateHubByID
	// removes the hub again — that expectation is part of the happy path.
	zerohubMock.EXPECT().
		RemoveHubById(gomock.Any()).
		MaxTimes(workers)

	h := newTestHandler()

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			// A fresh RequestCtx per goroutine, mirroring production where
			// fasthttp serves each request in its own worker.
			ctx := &fasthttp.RequestCtx{}
			ctx.Request.SetRequestURI("http://127.0.0.1/v1/hubs/create?id=" + hubId + "&hubMetadata=%7B%22name%22%3A%22test%22%7D")

			// Hub creation must succeed. The websocket handshake then
			// fails (plain GET, no upgrade) — a benign, expected error.
			// The racy path surfaces as a "create hub error", which is
			// what we guard against specifically.
			if err := h.CreateHubStatic(ctx, zerohubMock); err != nil &&
				strings.Contains(err.Error(), "create hub error") {
				t.Errorf("CreateHubStatic = %v, want no create-hub error (racy path taken)", err)
			}
		}()
	}
	wg.Wait()
}

// TestCreateHubStaticAlreadyExists pins the 409 mapping: when
// CreateHubIfAbsent reports the hub already exists, the handler must answer
// 409 Conflict — not 500 — so the losing side of a concurrent create gets
// the documented conflict status.
func TestCreateHubStaticAlreadyExists(t *testing.T) {
	const hubId = "hot-hub"

	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	zerohubMock.EXPECT().
		CreateHubIfAbsent(gomock.Any(), gomock.Any(), false).
		Return(nil, zerohub.ErrHubAlreadyExists).
		MaxTimes(1)

	h := newTestHandler()

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI("http://127.0.0.1/v1/hubs/create?id=" + hubId)

	if err := h.CreateHubStatic(ctx, zerohubMock); err != nil {
		t.Fatalf("CreateHubStatic returned unexpected error: %v", err)
	}
	if code := ctx.Response.StatusCode(); code != fasthttp.StatusConflict {
		t.Errorf("status = %d, want %d", code, fasthttp.StatusConflict)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "hub id already exists") {
		t.Errorf("body = %q, want it to contain the already-exists error", body)
	}
}

// TestCreateHubPermanentConcurrent is the permanent-hub variant of
// TestCreateHubStaticConcurrent: concurrent admin creates of the same
// permanent hub ID must all resolve through the single atomic
// CreateHubIfAbsent call against zeroHubPermanent.
func TestCreateHubPermanentConcurrent(t *testing.T) {
	const hubId = "hot-hub"
	const workers = 200

	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)

	sharedHub, err := hub.NewHub(hubId, `{"name":"test"}`, nil, true)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}

	// Permanent hubs must be created with isPermanent=true.
	zerohubMock.EXPECT().
		CreateHubIfAbsent(gomock.Any(), gomock.Any(), true).
		Return(sharedHub, nil).
		MaxTimes(workers)

	h := newTestHandler()
	h.zeroHubPermanent = zerohubMock

	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()

			ctx := &fasthttp.RequestCtx{}
			ctx.Request.Header.Set("Authorization", adminAuthHeader())
			ctx.Request.SetRequestURI("http://127.0.0.1/v1/permanent-hubs/create?id=" + hubId + "&hubMetadata=%7B%22name%22%3A%22test%22%7D")

			if err := h.CreateHubPermanent(ctx); err != nil &&
				strings.Contains(err.Error(), "create hub error") {
				t.Errorf("CreateHubPermanent = %v, want no create-hub error (racy path taken)", err)
			}
		}()
	}
	wg.Wait()
}

// TestCreateHubPermanentAlreadyExists pins the 409 mapping for the
// permanent-hub create path.
func TestCreateHubPermanentAlreadyExists(t *testing.T) {
	const hubId = "hot-hub"

	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	zerohubMock.EXPECT().
		CreateHubIfAbsent(gomock.Any(), gomock.Any(), true).
		Return(nil, zerohub.ErrHubAlreadyExists).
		MaxTimes(1)

	h := newTestHandler()
	h.zeroHubPermanent = zerohubMock

	ctx := &fasthttp.RequestCtx{}
	ctx.Request.Header.Set("Authorization", adminAuthHeader())
	ctx.Request.SetRequestURI("http://127.0.0.1/v1/permanent-hubs/create?id=" + hubId)

	if err := h.CreateHubPermanent(ctx); err != nil {
		t.Fatalf("CreateHubPermanent returned unexpected error: %v", err)
	}
	if code := ctx.Response.StatusCode(); code != fasthttp.StatusConflict {
		t.Errorf("status = %d, want %d", code, fasthttp.StatusConflict)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "hub id already exists") {
		t.Errorf("body = %q, want it to contain the already-exists error", body)
	}
}
