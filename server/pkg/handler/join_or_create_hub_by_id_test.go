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

// TestJoinOrCreateHubConcurrent proves the handler resolves the hub via the
// atomic GetOrCreateHub primitive — not the old GetHubById-then-NewHub dance —
// so N concurrent join-or-create requests for the same ID all funnel into the
// same hub. Before the fix, two requests interleaving at the "is the hub
// present?" check would each call NewHub and the second Add would silently
// orphan the first hub, splitting the room.
//
// The mock returns one shared hub instance for every GetOrCreateHub call. Any
// call to NewHub (the racy path) would fail the test, because the handler no
// longer has an expectation set for it.
func TestJoinOrCreateHubConcurrent(t *testing.T) {
	const hubId = "hot-hub"
	const workers = 200

	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)

	// One real hub instance shared by every goroutine.
	sharedHub, err := hub.NewHub(hubId, `{"name":"test"}`, nil, false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	// GetOrCreateHub is the ONLY hub-resolution call the handler may make.
	zerohubMock.EXPECT().
		GetOrCreateHub(gomock.Any(), gomock.Any(), false).
		Return(sharedHub, nil).
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
			ctx.Request.SetRequestURI("http://127.0.0.1/v1/hubs/join-or-create?hubMetadata=%7B%22name%22%3A%22test%22%7D")

			// Hub resolution must succeed. The websocket handshake then fails
			// (plain GET, no upgrade) — a benign, expected error. The racy
			// path surfaces as a "create hub error", which is what we guard
			// against specifically.
			if err := h.JoinOrCreateHubByID(ctx, zerohubMock, hubId); err != nil &&
				strings.Contains(err.Error(), "create hub error") {
				t.Errorf("JoinOrCreateHubByID = %v, want no create-hub error (racy path taken)", err)
			}
		}()
	}
	wg.Wait()
}
