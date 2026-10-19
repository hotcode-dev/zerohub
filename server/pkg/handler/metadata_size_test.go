package handler

import (
	"strings"
	"testing"

	"github.com/hotcode-dev/zerohub/pkg/config"
	hub "github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/peer"
	"github.com/hotcode-dev/zerohub/pkg/storage"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
	"go.uber.org/mock/gomock"
)

// oversizedValue is exactly one byte past the application-level metadata cap
// (config.MaxMetadataSize): the value the size guard has to reject. In tests
// the request is built in-process via RequestCtx.SetRequestURI, so
// fasthttp's 4kb request-head limit (ReadBufferSize) is not in play — these
// tests pin the application guard, not the transport default.
var oversizedValue = strings.Repeat("a", config.MaxMetadataSize+1)

// boundaryValue returns valid JSON of exactly config.MaxMetadataSize bytes:
// `{"pad":"<4086 'b's>"}` — 8 + 4086 + 2 = 4096. A value at the cap must
// pass the size guard and flow through to the next stage of validation.
func boundaryValue() string {
	return `{"pad":"` + strings.Repeat("b", config.MaxMetadataSize-len(`{"pad":""}`)) + `"}`
}

// assertOversizedParamRejected pins the 413 contract: the status, and the
// response body naming the offending parameter.
func assertOversizedParamRejected(t *testing.T, ctx *fasthttp.RequestCtx, param string) {
	t.Helper()
	if got := ctx.Response.StatusCode(); got != fasthttp.StatusRequestEntityTooLarge {
		t.Fatalf("%s: status = %d, want 413", param, got)
	}
	body := string(ctx.Response.Body())
	if !strings.Contains(body, param) {
		t.Fatalf("%s: body = %q, want an error naming %q", param, body, param)
	}
}

// TestUpgradeRejectsOversizedPeerMetadata verifies that a `peerMetadata`
// value longer than the cap is rejected with 413 before the websocket
// handshake, so it never enters hub state to be re-broadcast to every
// existing peer in PeerJoinedMessage. The real hub + memory peer storage
// proves no peer was registered: on an empty hub RemovePeerById("1") (the
// id the first registered peer would get) returns false, whereas it would
// return true if a peer had been added.
func TestUpgradeRejectsOversizedPeerMetadata(t *testing.T) {
	hubInstance, err := hub.NewHub("size-hub", `{}`, storage.NewMemoryStorage[peer.Peer](), false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	// No expectations: any ZeroHub call would mean the rejection did not
	// happen up front.
	h := newTestHandler()

	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join?id=size-hub&peerMetadata=" + oversizedValue)
	// Upgrade reports responseWritten=true: the 413 was already written and
	// no caller-level fallback may overwrite it.
	if err, responseWritten := h.Upgrade(ctx, zerohubMock, hubInstance); err != nil || responseWritten != true {
		t.Fatalf("Upgrade with oversized peerMetadata: got (err=%v, responseWritten=%v), want (nil, true)", err, responseWritten)
	}
	assertOversizedParamRejected(t, ctx, "peerMetadata")

	// The peer must not have been registered: the first peer would carry
	// id "1", and RemovePeerById returns true only for a present peer.
	if hubInstance.RemovePeerById("1") {
		t.Fatal("peer was registered despite oversized peerMetadata: hub state was mutated")
	}
}

// TestCreateHubByIDRejectsOversizedHubMetadata verifies that an oversized
// `hubMetadata` is rejected with 413 before CreateHubIfAbsent: the value
// would otherwise be stored on the hub and re-sent to every subsequent
// joiner in HubInfoMessage.
func TestCreateHubByIDRejectsOversizedHubMetadata(t *testing.T) {
	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	// No expectations: no hub may be created or removed for an oversized
	// value — the 413 must be written before any hub-state access.
	h := newTestHandler()

	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create?id=size-hub&hubMetadata=" + oversizedValue)
	if err := h.CreateHubByID(ctx, zerohubMock, "size-hub"); err != nil {
		t.Fatalf("CreateHubByID with oversized hubMetadata: unexpected error %v", err)
	}
	assertOversizedParamRejected(t, ctx, "hubMetadata")
}

// TestJoinOrCreateHubByIDRejectsOversizedHubMetadata covers the
// join-or-create endpoint for the same oversized-`hubMetadata` rejection.
func TestJoinOrCreateHubByIDRejectsOversizedHubMetadata(t *testing.T) {
	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	// No expectations: GetOrCreateHub must never run for an oversized
	// value.
	h := newTestHandler()

	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join-or-create?id=size-hub&hubMetadata=" + oversizedValue)
	if err := h.JoinOrCreateHubByID(ctx, zerohubMock, "size-hub"); err != nil {
		t.Fatalf("JoinOrCreateHubByID with oversized hubMetadata: unexpected error %v", err)
	}
	assertOversizedParamRejected(t, ctx, "hubMetadata")
}

// TestCreateHubPermanentRejectsOversizedHubMetadata covers the admin-only
// permanent hub create endpoint. The 413 must win over the cross-mode
// collision guard, which runs after the size check.
func TestCreateHubPermanentRejectsOversizedHubMetadata(t *testing.T) {
	ctrl := gomock.NewController(t)
	permanentMock := zerohub.NewMockZeroHub(ctrl)
	// No expectations: the 413 must be written before any hub-state access.
	h := &handler{clientSecret: testClientSecret, zeroHubPermanent: permanentMock}

	ctx := newRequestCtx("http://127.0.0.1/v1/permanent-hubs/create?id=perm-hub&hubMetadata=" + oversizedValue)
	ctx.Request.Header.Set("Authorization", adminAuthHeader())
	if err := h.CreateHubPermanent(ctx); err != nil {
		t.Fatalf("CreateHubPermanent with oversized hubMetadata: unexpected error %v", err)
	}
	assertOversizedParamRejected(t, ctx, "hubMetadata")
}

// TestOversizedIdRejected covers the id cap on every by-id entry point:
// the oversized id must be answered with 413 before any hub-state access
// (no CreateHubIfAbsent / GetOrCreateHub / GetHubById calls — pinned by the
// zero mock expectations).
func TestOversizedIdRejected(t *testing.T) {
	oversizedID := strings.Repeat("a", config.MaxMetadataSize+1)

	t.Run("CreateHubByID", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		zerohubMock := zerohub.NewMockZeroHub(ctrl)
		h := newTestHandler()

		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create?id=x&hubMetadata=")
		if err := h.CreateHubByID(ctx, zerohubMock, oversizedID); err != nil {
			t.Fatalf("CreateHubByID with oversized id: unexpected error %v", err)
		}
		assertOversizedParamRejected(t, ctx, "id")
	})

	t.Run("JoinOrCreateHubByID", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		zerohubMock := zerohub.NewMockZeroHub(ctrl)
		h := newTestHandler()

		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join-or-create?id=x")
		if err := h.JoinOrCreateHubByID(ctx, zerohubMock, oversizedID); err != nil {
			t.Fatalf("JoinOrCreateHubByID with oversized id: unexpected error %v", err)
		}
		assertOversizedParamRejected(t, ctx, "id")
	})

	t.Run("JoinHub", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		zerohubMock := zerohub.NewMockZeroHub(ctrl)
		h := newTestHandler()

		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join?id=" + oversizedID)
		if err := h.JoinHub(ctx, zerohubMock); err != nil {
			t.Fatalf("JoinHub with oversized id: unexpected error %v", err)
		}
		assertOversizedParamRejected(t, ctx, "id")
	})

	t.Run("GetHub", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		zerohubMock := zerohub.NewMockZeroHub(ctrl)
		h := newTestHandler()

		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/get?id=" + oversizedID)
		if err := h.GetHub(ctx, zerohubMock); err != nil {
			t.Fatalf("GetHub with oversized id: unexpected error %v", err)
		}
		assertOversizedParamRejected(t, ctx, "id")
	})

	t.Run("CreateHubPermanent", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		permanentMock := zerohub.NewMockZeroHub(ctrl)
		// The 413 for the oversized id must win over the cross-mode
		// collision guard, so zeroHub/zeroHubRandom can stay nil.
		h := &handler{clientSecret: testClientSecret, zeroHubPermanent: permanentMock}

		ctx := newRequestCtx("http://127.0.0.1/v1/permanent-hubs/create?id=" + oversizedID)
		ctx.Request.Header.Set("Authorization", adminAuthHeader())
		if err := h.CreateHubPermanent(ctx); err != nil {
			t.Fatalf("CreateHubPermanent with oversized id: unexpected error %v", err)
		}
		assertOversizedParamRejected(t, ctx, "id")
	})
}

// TestBoundaryValuesAccepted verifies the cap is inclusive: values of
// exactly config.MaxMetadataSize bytes pass the size guard and flow into
// the next stage — the mock expectations prove the value actually reached
// the hub-resolution layer with the verbatim string intact.
func TestBoundaryValuesAccepted(t *testing.T) {
	cap := boundaryValue()
	if len(cap) != config.MaxMetadataSize {
		t.Fatalf("boundaryValue length = %d, want %d", len(cap), config.MaxMetadataSize)
	}

	// hubMetadata at the cap: CreateHubByID must hand the verbatim value to
	// CreateHubIfAbsent — the Times(1) expectation (enforced by the gomock
	// controller on subtest exit) is the proof that the size guard did not
	// short-circuit the request. The subsequent upgrade fails on the plain
	// GET (expected): that path rolls the hub back via RemoveHubById and
	// writes a 500, so the request provably reached hub resolution.
	t.Run("hubMetadata at cap reaches CreateHubIfAbsent", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		zerohubMock := zerohub.NewMockZeroHub(ctrl)
		sharedHub, err := hub.NewHub("cap-hub", cap, nil, false)
		if err != nil {
			t.Fatalf("NewHub: %v", err)
		}
		zerohubMock.EXPECT().
			CreateHubIfAbsent("cap-hub", cap, false).
			Return(sharedHub, nil).
			Times(1)
		zerohubMock.EXPECT().
			RemoveHubById("cap-hub").
			MaxTimes(1)
		h := newTestHandler()

		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create?id=cap-hub&hubMetadata=" +
			"%7B%22pad%22%3A%22" + strings.Repeat("b", config.MaxMetadataSize-len(`{"pad":""}`)) + `%22%7D`)
		// The query string is URL-decoded by fasthttp's QueryArgs, so the
		// percent-encoded boundary JSON above decodes to `cap`.
		if err := h.CreateHubByID(ctx, zerohubMock, "cap-hub"); err != nil {
			t.Fatalf("CreateHubByID with cap-sized hubMetadata: unexpected error %v", err)
		}
		// 500 (upgrade-failure response) proves the request got past the
		// size + shape guards all the way to the websocket handshake.
		if got := ctx.Response.StatusCode(); got == fasthttp.StatusRequestEntityTooLarge {
			t.Fatalf("cap-sized hubMetadata: status = 413, the size guard misfired at the boundary")
		}
	})

	// id at the cap: CreateHubByID must accept it and reach
	// CreateHubIfAbsent with the verbatim id — proven by the Times(1)
	// expectation below.
	t.Run("id at cap reaches CreateHubIfAbsent", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		zerohubMock := zerohub.NewMockZeroHub(ctrl)
		capID := strings.Repeat("a", config.MaxMetadataSize)
		sharedHub, err := hub.NewHub(capID, "", nil, false)
		if err != nil {
			t.Fatalf("NewHub: %v", err)
		}
		zerohubMock.EXPECT().
			CreateHubIfAbsent(capID, "", false).
			Return(sharedHub, nil).
			Times(1)
		zerohubMock.EXPECT().
			RemoveHubById(capID).
			MaxTimes(1)
		h := newTestHandler()

		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create")
		// No `id` in the query: CreateHubByID receives the id verbatim
		// from the caller, exactly like the static endpoint passes it.
		if err := h.CreateHubByID(ctx, zerohubMock, capID); err != nil {
			t.Fatalf("CreateHubByID with cap-sized id: unexpected error %v", err)
		}
		// Not the 413 that the size guard would write for an oversized id.
		if got := ctx.Response.StatusCode(); got == fasthttp.StatusRequestEntityTooLarge {
			t.Fatalf("cap-sized id: status = 413, the size guard misfired at the boundary")
		}
	})

	// peerMetadata at the cap: Upgrade must clear both the size and the
	// JSON-shape guards and reach the websocket handshake, which fails on
	// the plain GET — expected — with responseWritten=false (nothing was
	// rejected up front).
	t.Run("peerMetadata at cap reaches handshake", func(t *testing.T) {
		hubInstance, err := hub.NewHub("cap-hub", `{}`, nil, false)
		if err != nil {
			t.Fatalf("NewHub: %v", err)
		}
		ctrl := gomock.NewController(t)
		zerohubMock := zerohub.NewMockZeroHub(ctrl)
		h := newTestHandler()

		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join?id=cap-hub&peerMetadata=" + cap)
		if err, responseWritten := h.Upgrade(ctx, zerohubMock, hubInstance); err == nil ||
			!strings.Contains(err.Error(), "websocket") || responseWritten != false {
			t.Fatalf("Upgrade with cap-sized peerMetadata: got (err=%v, responseWritten=%v), want websocket upgrade error and responseWritten=false", err, responseWritten)
		}
		// A 413/400 would mean the size or shape guard misfired at the
		// boundary; the upgrader's own 400 on the failed handshake is the
		// expected outcome and is not an application rejection.
		if got := ctx.Response.StatusCode(); got == fasthttp.StatusRequestEntityTooLarge {
			t.Fatalf("Upgrade with cap-sized peerMetadata: status = 413, the size guard misfired at the boundary")
		}
	})
}

// TestOversizedValueWinsOverShape verifies the guard ordering: a value that
// is both oversized and malformed JSON gets the 413 (size), not the 400
// (shape) — size runs first, so the shape checker never sees the value.
func TestOversizedValueWinsOverShape(t *testing.T) {
	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	h := newTestHandler()

	// oversizedValue is 4097 'a's: neither valid JSON nor size-legal.
	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join-or-create?id=size-hub&hubMetadata=" + oversizedValue)
	if err := h.JoinOrCreateHubByID(ctx, zerohubMock, "size-hub"); err != nil {
		t.Fatalf("JoinOrCreateHubByID: unexpected error %v", err)
	}
	assertOversizedParamRejected(t, ctx, "hubMetadata")
	if body := string(ctx.Response.Body()); strings.Contains(body, "must be JSON") {
		t.Fatalf("body = %q, want the 413 size error, not the 400 shape error", body)
	}
}
