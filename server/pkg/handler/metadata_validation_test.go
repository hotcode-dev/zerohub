package handler

import (
	"strings"
	"testing"

	hub "github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
	"go.uber.org/mock/gomock"
)

// newRequestCtx builds a fresh RequestCtx with an absolute request URI,
// mirroring how fasthttp worker goroutines see each request.
func newRequestCtx(uri string) *fasthttp.RequestCtx {
	ctx := &fasthttp.RequestCtx{}
	ctx.Request.SetRequestURI(uri)
	return ctx
}

// TestJoinOrCreateHubByIDRejectsMalformedHubMetadata verifies that a
// non-JSON `hubMetadata` query parameter is rejected with 400 before any hub
// state is touched: no hub may be created with metadata that would crash the
// clients' JSON.parse on the re-broadcast HubInfoMessage.
func TestJoinOrCreateHubByIDRejectsMalformedHubMetadata(t *testing.T) {
	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	// No expectations: any hub-resolution call would mean the malformed
	// metadata reached hub state.
	h := newTestHandler()

	for _, raw := range []string{"not-json", "%21"} {
		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join-or-create?id=bad-hub&hubMetadata=" + raw)
		// rejectInvalidJSONParam writes the 400 via Response (which returns
		// nil on success), so the contract is pinned by the written status,
		// not the error value.
		if err := h.JoinOrCreateHubByID(ctx, zerohubMock, "bad-hub"); err != nil {
			t.Fatalf("JoinOrCreateHubByID with hubMetadata=%q: unexpected error %v", raw, err)
		}
		if got := ctx.Response.StatusCode(); got != fasthttp.StatusBadRequest {
			t.Fatalf("hubMetadata=%q: status = %d, want 400", raw, got)
		}
		if body := string(ctx.Response.Body()); !strings.Contains(body, "must be JSON") {
			t.Fatalf("hubMetadata=%q: body = %q, want 'must be JSON' error", raw, body)
		}
	}
}

// TestJoinOrCreateHubByIDAcceptsValidHubMetadata verifies the valid-JSON path
// still resolves the hub and hands the raw metadata string to GetOrCreateHub.
func TestJoinOrCreateHubByIDAcceptsValidHubMetadata(t *testing.T) {
	const valid = `{"name":"test"}`

	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	sharedHub, err := hub.NewHub("valid-hub", valid, nil, false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	// The metadata passed to hub resolution must be the verbatim raw string.
	zerohubMock.EXPECT().
		GetOrCreateHub("valid-hub", valid, false).
		Return(sharedHub, nil).
		Times(1)
	h := newTestHandler()

	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join-or-create?id=valid-hub&hubMetadata=" +
		"%7B%22name%22%3A%22test%22%7D")
	if err := h.JoinOrCreateHubByID(ctx, zerohubMock, "valid-hub"); err != nil &&
		!strings.Contains(err.Error(), "websocket") {
		t.Fatalf("JoinOrCreateHubByID with valid metadata = %v, want at most a websocket upgrade error", err)
	}
}

// TestCreateHubByIDRejectsMalformedHubMetadata covers the static create
// endpoint (and by extension random hubs, which funnel through
// CreateHubByID) for the same malformed-metadata rejection.
func TestCreateHubByIDRejectsMalformedHubMetadata(t *testing.T) {
	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	h := newTestHandler()

	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create?id=bad-hub&hubMetadata=not-json")
	if err := h.CreateHubByID(ctx, zerohubMock, "bad-hub"); err != nil {
		t.Fatalf("CreateHubByID with malformed hubMetadata: unexpected error %v", err)
	}
	if got := ctx.Response.StatusCode(); got != fasthttp.StatusBadRequest {
		t.Fatalf("status = %d, want 400", got)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "must be JSON") {
		t.Fatalf("body = %q, want 'must be JSON' error", body)
	}
}

// TestCreateHubPermanentRejectsMalformedHubMetadata covers the admin-only
// permanent hub create endpoint.
func TestCreateHubPermanentRejectsMalformedHubMetadata(t *testing.T) {
	ctrl := gomock.NewController(t)
	permanentMock := zerohub.NewMockZeroHub(ctrl)
	// No expectations: the 400 for malformed metadata must be written
	// before any hub-state access (CreateHubIfAbsent).
	h := &handler{clientSecret: testClientSecret, zeroHubPermanent: permanentMock}

	ctx := newRequestCtx("http://127.0.0.1/v1/permanent-hubs/create?id=perm-hub&hubMetadata=not-json")
	ctx.Request.Header.Set("Authorization", adminAuthHeader())
	if err := h.CreateHubPermanent(ctx); err != nil {
		t.Fatalf("CreateHubPermanent with malformed hubMetadata: unexpected error %v", err)
	}
	if got := ctx.Response.StatusCode(); got != fasthttp.StatusBadRequest {
		t.Fatalf("status = %d, want 400", got)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "must be JSON") {
		t.Fatalf("body = %q, want 'must be JSON' error", body)
	}
}

// TestUpgradeRejectsMalformedPeerMetadata verifies that a non-JSON
// `peerMetadata` query parameter is rejected with 400 before the websocket
// handshake, so malformed peer metadata never enters hub state to be
// re-broadcast in PeerJoinedMessage.
func TestUpgradeRejectsMalformedPeerMetadata(t *testing.T) {
	hubInstance, err := hub.NewHub("upg-hub", `{"name":"test"}`, nil, false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	// No expectations: the rejection must happen before any hub mutation.
	h := newTestHandler()

	// Malformed peerMetadata: 400 written before the handshake attempt.
	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join?id=upg-hub&peerMetadata=not-json")
	if err := h.Upgrade(ctx, zerohubMock, hubInstance); err != nil {
		t.Fatalf("Upgrade with malformed peerMetadata: unexpected error %v", err)
	}
	if got := ctx.Response.StatusCode(); got != fasthttp.StatusBadRequest {
		t.Fatalf("status = %d, want 400", got)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "must be JSON") {
		t.Fatalf("body = %q, want 'must be JSON' error", body)
	}

	// Valid peerMetadata: passes validation and reaches the websocket
	// handshake, which fails on the plain GET — expected.
	ctx = newRequestCtx("http://127.0.0.1/v1/hubs/join?id=upg-hub&peerMetadata=%7B%22name%22%3A%22test%22%7D")
	if err := h.Upgrade(ctx, zerohubMock, hubInstance); err == nil ||
		!strings.Contains(err.Error(), "websocket") {
		t.Fatalf("Upgrade with valid peerMetadata = %v, want websocket upgrade error", err)
	}
}
