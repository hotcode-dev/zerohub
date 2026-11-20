package handler

import (
	"errors"
	"net/url"
	"strings"
	"testing"

	hub "github.com/hotcode-dev/zerohub/pkg/hub"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
	"go.uber.org/mock/gomock"
)

// TestClaimHubForCreateSuccess pins the shared create-claim helper's success
// contract: on a free id it hands back the created hub with ok=true and
// writes no response — the caller owns what happens next (the WebSocket
// upgrade for /hub/create, the 200 JSON for /v1/static-hubs/create). It also
// pins the metadata passthrough: hubMetadata is read verbatim from the query
// args, and the isPermanent flag is forwarded to CreateHubIfAbsent.
func TestClaimHubForCreateSuccess(t *testing.T) {
	const hubId = "room"
	const metadata = `{"name":"test"}`

	ctrl := gomock.NewController(t)
	zh := zerohub.NewMockZeroHub(ctrl)
	created := hub.NewHub(hubId, metadata, nil, true)
	zh.EXPECT().
		CreateHubIfAbsent(hubId, metadata, true).
		Return(created, nil).
		MaxTimes(1)
	sibling := zerohub.NewMockZeroHub(ctrl)
	sibling.EXPECT().GetHubById(hubId).Return(nil).MaxTimes(1)

	h := newTestHandler()
	h.zeroHubStatic = zh
	h.zeroHubRandom = sibling

	ctx := newRequestCtx("http://127.0.0.1/v1/static-hubs/create?id=" + hubId +
		"&hubMetadata=" + url.QueryEscape(metadata))

	newHub, ok := h.claimHubForCreate(ctx, zh, hubId, true)
	if !ok || newHub != created {
		t.Fatalf("claimHubForCreate = (hub:%v, ok:%v), want the created hub and ok=true", newHub, ok)
	}
	if len(ctx.Response.Body()) != 0 {
		t.Errorf("success path wrote a response (%q), want none — the caller writes the response", ctx.Response.Body())
	}
}

// TestClaimHubForCreateSiblingCollision pins the rejected branch: when a
// sibling hub mode already holds the id, claimUserChosenHubId writes the 409
// collision and the helper must stop without touching the create target or
// overwriting the response.
func TestClaimHubForCreateSiblingCollision(t *testing.T) {
	const hubId = "room"
	colliding := hub.NewHub(hubId, `{"name":"x"}`, nil, false)

	ctrl := gomock.NewController(t)
	zh := zerohub.NewMockZeroHub(ctrl)
	// No CreateHubIfAbsent expectation: the collision must abort before
	// the create target is touched.
	sibling := zerohub.NewMockZeroHub(ctrl)
	sibling.EXPECT().GetHubById(hubId).Return(colliding).Times(1)

	h := newTestHandler()
	h.zeroHubStatic = zh
	h.zeroHubRandom = sibling

	ctx := newRequestCtx("http://127.0.0.1/v1/static-hubs/create?id=" + hubId)

	newHub, ok := h.claimHubForCreate(ctx, zh, hubId, true)
	if ok || newHub != nil {
		t.Fatalf("claimHubForCreate = (hub:%v, ok:%v), want (nil, false) on sibling collision", newHub, ok)
	}
	if code := ctx.Response.StatusCode(); code != fasthttp.StatusConflict {
		t.Errorf("status = %d, want %d", code, fasthttp.StatusConflict)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "hub id collides with another hub type") {
		t.Errorf("body = %q, want it to contain the collision error", body)
	}
}

// TestClaimHubForCreateAlreadyExists pins the same-mode 409 mapping: when
// CreateHubIfAbsent reports the hub already exists, the helper must answer
// 409 "hub id already exists" — not 500 — so the losing side of a concurrent
// create gets the documented conflict status.
func TestClaimHubForCreateAlreadyExists(t *testing.T) {
	const hubId = "room"

	ctrl := gomock.NewController(t)
	zh := zerohub.NewMockZeroHub(ctrl)
	zh.EXPECT().
		CreateHubIfAbsent(gomock.Any(), gomock.Any(), true).
		Return(nil, zerohub.ErrHubAlreadyExists).
		MaxTimes(1)
	sibling := zerohub.NewMockZeroHub(ctrl)
	sibling.EXPECT().GetHubById(hubId).Return(nil).MaxTimes(1)

	h := newTestHandler()
	h.zeroHubStatic = zh
	h.zeroHubRandom = sibling

	ctx := newRequestCtx("http://127.0.0.1/v1/static-hubs/create?id=" + hubId)

	newHub, ok := h.claimHubForCreate(ctx, zh, hubId, true)
	if ok || newHub != nil {
		t.Fatalf("claimHubForCreate = (hub:%v, ok:%v), want (nil, false) on ErrHubAlreadyExists", newHub, ok)
	}
	if code := ctx.Response.StatusCode(); code != fasthttp.StatusConflict {
		t.Errorf("status = %d, want %d", code, fasthttp.StatusConflict)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "hub id already exists") {
		t.Errorf("body = %q, want it to contain the already-exists error", body)
	}
}

// TestClaimHubForCreateGenericErrorMapsTo500 pins the fallback mapping: any
// create failure other than ErrHubAlreadyExists becomes 500
// "create hub error" (and never leaks the internal error to the client).
func TestClaimHubForCreateGenericErrorMapsTo500(t *testing.T) {
	const hubId = "room"

	ctrl := gomock.NewController(t)
	zh := zerohub.NewMockZeroHub(ctrl)
	zh.EXPECT().
		CreateHubIfAbsent(gomock.Any(), gomock.Any(), false).
		Return(nil, errors.New("storage boom")).
		MaxTimes(1)
	sibling := zerohub.NewMockZeroHub(ctrl)
	sibling.EXPECT().GetHubById(hubId).Return(nil).MaxTimes(1)

	h := newTestHandler()
	h.zeroHubRandom = zh
	h.zeroHubStatic = sibling

	ctx := newRequestCtx("http://127.0.0.1/hub/create?hubId=" + hubId)

	newHub, ok := h.claimHubForCreate(ctx, zh, hubId, false)
	if ok || newHub != nil {
		t.Fatalf("claimHubForCreate = (hub:%v, ok:%v), want (nil, false) on generic error", newHub, ok)
	}
	if code := ctx.Response.StatusCode(); code != fasthttp.StatusInternalServerError {
		t.Errorf("status = %d, want %d", code, fasthttp.StatusInternalServerError)
	}
	body := string(ctx.Response.Body())
	if !strings.Contains(body, "create hub error") {
		t.Errorf("body = %q, want it to contain 'create hub error'", body)
	}
	if strings.Contains(body, "storage boom") {
		t.Errorf("body = %q leaked the internal error; it must stay opaque", body)
	}
}
