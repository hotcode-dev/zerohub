package handler

import (
	"net"
	"testing"

	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

// newRealZeroHub builds a real ZeroHub backed by the memory storage backend —
// the backend that has no TTL — so orphan-hub assertions can inspect actual
// storage state instead of mock call history.
func newRealZeroHub(t *testing.T) zerohub.ZeroHub {
	t.Helper()
	zh, err := zerohub.NewZeroHub(&config.Config{
		App: config.AppConfig{
			HubStorage:  "memory",
			PeerStorage: "memory",
		},
	})
	if err != nil {
		t.Fatalf("NewZeroHub: %v", err)
	}
	return zh
}

// TestJoinOrCreateRemovesOrphanOnUpgradeFailure pins the core P0 fix: when
// the WebSocket upgrade fails after this call created the hub (no hub
// pre-existed), the hub must be rolled back instead of lingering as an empty
// orphan in storage. A plain GET request always fails the handshake, which
// is the same failure mode as a malformed peerMetadata in production.
func TestJoinOrCreateRemovesOrphanOnUpgradeFailure(t *testing.T) {
	const hubId = "leak-hub"
	zh := newRealZeroHub(t)

	if got := zh.GetHubById(hubId); got != nil {
		t.Fatalf("pre-state: hub %q exists, want nil", hubId)
	}

	h := newTestHandler()
	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join-or-create?id=" + hubId)
	// Plain GET: the websocket handshake cannot succeed. The returned error
	// is expected (a websocket failure), not a "create hub error".
	_ = h.JoinOrCreateHubByID(ctx, zh, hubId)

	// Core assertion: no orphan hub remains in storage.
	if got := zh.GetHubById(hubId); got != nil {
		t.Fatalf("hub %q still present after failed upgrade, want removed (orphan leak)", hubId)
	}
}

// TestJoinOrCreateKeepsExistingHubOnUpgradeFailure is the reverse (the
// regression guard a naive copy-paste of the create-path cleanup would
// break): when the hub already existed before this call, a failed upgrade
// must NOT remove it — the call did not create it, so rolling it back could
// drop a live, in-use hub.
func TestJoinOrCreateKeepsExistingHubOnUpgradeFailure(t *testing.T) {
	const hubId = "pre-existing-hub"
	zh := newRealZeroHub(t)

	// Pre-seed the hub so it exists before the join-or-create call.
	seed, created, err := zh.GetOrCreateHub(hubId, "", false)
	if err != nil {
		t.Fatalf("seed GetOrCreateHub: %v", err)
	}
	if !created || seed == nil {
		t.Fatalf("seed: created=%v hub=%v, want (true, non-nil)", created, seed)
	}

	h := newTestHandler()
	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join-or-create?id=" + hubId)
	// Plain GET: the handshake fails. created=false here (the hub was
	// pre-seeded), so the cleanup path must be a no-op.
	_ = h.JoinOrCreateHubByID(ctx, zh, hubId)

	// Core assertion: the pre-existing hub survived the failed upgrade.
	if got := zh.GetHubById(hubId); got == nil {
		t.Fatalf("hub %q removed after failed upgrade on a pre-existing hub, want kept", hubId)
	}
}

// TestJoinOrCreateIPRemovesOrphanOnUpgradeFailure verifies the IP-hub
// endpoint inherits the same rollback: it funnels through
// JoinOrCreateHubByID, so a failed handshake on a fresh IP-derived hub ID
// must not leave an orphan.
func TestJoinOrCreateIPRemovesOrphanOnUpgradeFailure(t *testing.T) {
	zh := newRealZeroHub(t)
	h := newTestHandler()

	const socketIP = "203.0.113.5"
	key := ipHubKeyFor(socketIP)
	if got := zh.GetHubById(key); got != nil {
		t.Fatalf("pre-state: hub key %q exists, want nil", key)
	}

	// Mirror joinOrCreateHubIPRequest: set the socket peer so the derived
	// key is the xxh3 hash of the client IP, then a plain GET so the
	// handshake fails.
	ctx := &fasthttp.RequestCtx{}
	ctx.SetRemoteAddr(&net.TCPAddr{IP: net.ParseIP(socketIP)})
	ctx.Request.SetRequestURI("http://127.0.0.1/v1/ip-hubs/join-or-create")
	_ = h.JoinOrCreateHubIP(ctx, zh)

	// The failed-upgrade rollback must have removed the freshly created
	// IP-keyed hub from storage.
	if got := zh.GetHubById(key); got != nil {
		t.Fatalf("hub key %q still present after failed upgrade via IP endpoint, want removed (orphan leak)", key)
	}
}

// TestJoinOrCreatePreserves400OnMalformedPeerMetadata pins the secondary
// symptom of the same path: when the up-front peerMetadata rejection inside
// Upgrade has already written a 400, JoinOrCreateHubByID must not overwrite
// it with a 500.
func TestJoinOrCreatePreserves400OnMalformedPeerMetadata(t *testing.T) {
	const hubId = "md-hub"
	zh := newRealZeroHub(t)

	h := newTestHandler()
	// Malformed peerMetadata: Upgrade rejects it up front with a 400.
	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join-or-create?id=" + hubId + "&peerMetadata=not-json")
	_ = h.JoinOrCreateHubByID(ctx, zh, hubId)

	if got := ctx.Response.StatusCode(); got != 400 {
		t.Fatalf("status = %d, want 400 (the 400 written by the peerMetadata rejection must not be overwritten with a 500)", got)
	}
	// The hub this call created is still rolled back even though the 400
	// was written by Upgrade itself.
	if gotHub := zh.GetHubById(hubId); gotHub != nil {
		t.Fatalf("hub %q still present after rejected upgrade, want removed (orphan leak)", hubId)
	}
}

// TestCreateHubByIDPreserves400OnMalformedPeerMetadata covers the same
// response-overwrite symmetry on the create path.
func TestCreateHubByIDPreserves400OnMalformedPeerMetadata(t *testing.T) {
	const hubId = "md-hub-create"
	zh := newRealZeroHub(t)

	h := newTestHandler()
	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create?id=" + hubId + "&peerMetadata=not-json")
	_ = h.CreateHubByID(ctx, zh, hubId)

	if got := ctx.Response.StatusCode(); got != 400 {
		t.Fatalf("status = %d, want 400", got)
	}
	if gotHub := zh.GetHubById(hubId); gotHub != nil {
		t.Fatalf("hub %q still present after rejected upgrade, want removed", hubId)
	}
}

// TestJoinHubPreserves400OnMalformedPeerMetadata covers the join path: a
// pre-existing hub plus a malformed peerMetadata must keep the 400 (no 500)
// and must leave the pre-existing hub untouched.
func TestJoinHubPreserves400OnMalformedPeerMetadata(t *testing.T) {
	const hubId = "join-md-hub"
	zh := newRealZeroHub(t)

	seed, created, err := zh.GetOrCreateHub(hubId, "", false)
	if err != nil || !created || seed == nil {
		t.Fatalf("seed GetOrCreateHub = (%v, %v, %v), want (nil, true, hub)", seed, created, err)
	}

	h := newTestHandler()
	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/join?id=" + hubId + "&peerMetadata=not-json")
	_ = h.JoinHub(ctx, zh)

	if got := ctx.Response.StatusCode(); got != 400 {
		t.Fatalf("status = %d, want 400", got)
	}
	if gotHub := zh.GetHubById(hubId); gotHub == nil {
		t.Fatalf("hub %q removed after rejected upgrade on a pre-existing hub, want kept", hubId)
	}
}
