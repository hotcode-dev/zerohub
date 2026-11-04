package handler

import (
	"strings"
	"testing"

	hub "github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
	"go.uber.org/mock/gomock"
)

// checkInvalidHubIdResponse pins the 400 + body contract written by
// rejectInvalidHubIdParam for a given request ctx.
func checkInvalidHubIdResponse(t *testing.T, ctx *fasthttp.RequestCtx, label string) {
	t.Helper()
	if got := ctx.Response.StatusCode(); got != fasthttp.StatusBadRequest {
		t.Fatalf("%s: status = %d, want 400", label, got)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "id query parameter is required") {
		t.Fatalf("%s: body = %q, want 'id query parameter is required' error", label, body)
	}
}

// TestCreateStaticHubRejectsEmptyHubId covers the admin-gated static hub
// create endpoint: an empty id must be rejected with 400 (with valid admin
// auth) and no static hub must be persisted under the empty string.
func TestCreateStaticHubRejectsEmptyHubId(t *testing.T) {
	ctrl := gomock.NewController(t)
	staticMock := zerohub.NewMockZeroHub(ctrl)
	// No expectations: the 400 must be written before CreateHubIfAbsent.
	h := &handler{clientSecret: testClientSecret, zeroHubStatic: staticMock}

	ctx := newRequestCtx("http://127.0.0.1/v1/static-hubs/create?id=")
	ctx.Request.Header.Set("Authorization", adminAuthHeader())
	if err := h.CreateStaticHub(ctx); err != nil {
		t.Fatalf("CreateStaticHub with empty id: unexpected error %v", err)
	}
	checkInvalidHubIdResponse(t, ctx, "CreateStaticHub empty id")
}

// TestCreateStaticHubAuthPrecedenceOverInvalidId pins the ordering
// choice: an unauthenticated request with an empty id gets 401, not 400.
func TestCreateStaticHubAuthPrecedenceOverInvalidId(t *testing.T) {
	ctrl := gomock.NewController(t)
	staticMock := zerohub.NewMockZeroHub(ctrl)
	h := &handler{clientSecret: testClientSecret, zeroHubStatic: staticMock}

	ctx := newRequestCtx("http://127.0.0.1/v1/static-hubs/create")
	// No Authorization header.
	if err := h.CreateStaticHub(ctx); err == nil {
		t.Fatalf("CreateStaticHub without auth: expected an error")
	}
	if got := ctx.Response.StatusCode(); got != fasthttp.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", got)
	}
}

// TestJoinHubRejectsEmptyHubId verifies that /v1/random-hubs/join with a
// missing/empty id is rejected with 400 instead of degrading to 404 (or a
// migration forward).
func TestJoinHubRejectsEmptyHubId(t *testing.T) {
	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	// No expectations: no hub lookup may happen for an empty id.
	h := newTestHandler()

	for _, uri := range []string{
		"http://127.0.0.1/v1/random-hubs/join",
		"http://127.0.0.1/v1/random-hubs/join?id=",
	} {
		ctx := newRequestCtx(uri)
		if err := h.JoinHub(ctx, zerohubMock); err != nil {
			t.Fatalf("JoinHub %s: unexpected error %v", uri, err)
		}
		checkInvalidHubIdResponse(t, ctx, uri)
	}
}

// TestGetHubRejectsEmptyHubId verifies that /v1/random-hubs/get with a missing/
// empty id is rejected with 400 for consistency with the other hub
// endpoints.
func TestGetHubRejectsEmptyHubId(t *testing.T) {
	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	// No expectations: no hub lookup may happen for an empty id.
	h := newTestHandler()

	for _, uri := range []string{
		"http://127.0.0.1/v1/random-hubs/get",
		"http://127.0.0.1/v1/random-hubs/get?id=",
	} {
		ctx := newRequestCtx(uri)
		if err := h.GetHub(ctx, zerohubMock); err != nil {
			t.Fatalf("GetHub %s: unexpected error %v", uri, err)
		}
		checkInvalidHubIdResponse(t, ctx, uri)
	}
}

// TestCreateHubRandomStillCreatesAfterHubIdValidation is the regression
// guard for the shared-helper validation: the random-hub path passes a
// fresh uuid (never empty), so it must still create normally through
// CreateHubByID.
func TestCreateHubRandomStillCreatesAfterHubIdValidation(t *testing.T) {
	// One real hub instance returned by the mock for any CreateHubIfAbsent
	// call. The websocket handshake then fails (plain GET, no upgrade) — a
	// benign, expected error, and RemoveHubById cleans up on that path.
	ctrl := gomock.NewController(t)
	zerohubMock := zerohub.NewMockZeroHub(ctrl)
	sharedHub, err := hub.NewHub("random-hub", `{"name":"test"}`, nil, false)
	if err != nil {
		t.Fatalf("NewHub: %v", err)
	}
	zerohubMock.EXPECT().
		CreateHubIfAbsent(gomock.Any(), gomock.Any(), false).
		Return(sharedHub, nil).
		MaxTimes(1)
	zerohubMock.EXPECT().
		RemoveHubById(gomock.Any()).
		MaxTimes(1)

	h := newTestHandler()

	// The random-hub endpoint has no `id` query parameter; the handler
	// generates the uuid itself.
	ctx := newRequestCtx("http://127.0.0.1/v1/random-hubs/create")
	// Creation must succeed. The websocket handshake then fails — a
	// benign, expected error. A "create hub error" or a 400 from the new
	// validation would surface here.
	if err := h.CreateHubRandom(ctx, zerohubMock); err != nil {
		if strings.Contains(err.Error(), "create hub error") {
			t.Fatalf("CreateHubRandom = %v, want hub creation to succeed", err)
		}
		if !strings.Contains(err.Error(), "websocket") {
			t.Fatalf("CreateHubRandom = %v, want at most a websocket upgrade error", err)
		}
	}
	// A 400 would mean the empty-id check misfired on the uuid path.
	if got := ctx.Response.StatusCode(); got == fasthttp.StatusBadRequest {
		t.Fatalf("status = 400, want the random-hub path to pass validation")
	}
}

// TestJoinOrCreateHubIPStillCreatesAfterHubIdValidation is the IP-hub
// counterpart: the xxh3 hash of the client IP is never empty, so the
// shared-helper validation must not misfire.
func TestJoinOrCreateHubIPStillCreatesAfterHubIdValidation(t *testing.T) {
	h := newTestHandler()

	var got string
	key := joinOrCreateHubIPRequest(t, h, &got, "203.0.113.5", "")
	if key == "" {
		t.Fatalf("JoinOrCreateHubIP derived an empty hub key")
	}
	// Sanity: the derived key matches the documented scheme.
	if got != ipHubKeyFor("203.0.113.5") {
		t.Fatalf("hub key = %q, want %q", got, ipHubKeyFor("203.0.113.5"))
	}
}
