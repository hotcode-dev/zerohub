package handler

import (
	"strings"
	"testing"

	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/valyala/fasthttp"
)

// The tests below exercise validateHubCreateParams directly, pinning the
// shared helper's contract so a future change to its check order or
// strictness fails here regardless of which endpoint regresses. The
// per-endpoint tests (hub_id_validation_test.go, metadata_size_test.go,
// metadata_validation_test.go) pin the observable behavior of each handler;
// these pin the shared ordering itself.

// TestValidateHubCreateParamsRejections pins the exact status each failing
// check writes. The helper returns true and has written the body; a caller
// must stop on that signal (that is what "returns a rejection" means here,
// given the reject* helpers write the response and return nil).
func TestValidateHubCreateParamsRejections(t *testing.T) {
	h := newTestHandler()

	t.Run("empty id -> 400", func(t *testing.T) {
		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create")
		if !h.validateHubCreateParams(ctx, "") {
			t.Fatal("empty id: helper returned false, want true (rejection written)")
		}
		if got := ctx.Response.StatusCode(); got != fasthttp.StatusBadRequest {
			t.Fatalf("status = %d, want 400", got)
		}
		if body := string(ctx.Response.Body()); !strings.Contains(body, "id query parameter is required") {
			t.Fatalf("body = %q, want 'id query parameter is required'", body)
		}
	})

	t.Run("whitespace-only id -> 400", func(t *testing.T) {
		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create")
		if !h.validateHubCreateParams(ctx, "   ") {
			t.Fatal("whitespace id: helper returned false, want true (rejection written)")
		}
		if got := ctx.Response.StatusCode(); got != fasthttp.StatusBadRequest {
			t.Fatalf("status = %d, want 400", got)
		}
	})

	t.Run("oversized id -> 413", func(t *testing.T) {
		oversizedID := strings.Repeat("a", config.MaxMetadataSize+1)
		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create")
		if !h.validateHubCreateParams(ctx, oversizedID) {
			t.Fatal("oversized id: helper returned false, want true (rejection written)")
		}
		if got := ctx.Response.StatusCode(); got != fasthttp.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, want 413", got)
		}
		if body := string(ctx.Response.Body()); !strings.Contains(body, "id") {
			t.Fatalf("body = %q, want an error naming 'id'", body)
		}
	})

	t.Run("oversized hubMetadata -> 413", func(t *testing.T) {
		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create?id=ok-hub&hubMetadata=" + oversizedValue)
		if !h.validateHubCreateParams(ctx, "ok-hub") {
			t.Fatal("oversized hubMetadata: helper returned false, want true (rejection written)")
		}
		if got := ctx.Response.StatusCode(); got != fasthttp.StatusRequestEntityTooLarge {
			t.Fatalf("status = %d, want 413", got)
		}
		if body := string(ctx.Response.Body()); !strings.Contains(body, "hubMetadata") {
			t.Fatalf("body = %q, want an error naming 'hubMetadata'", body)
		}
	})

	t.Run("malformed hubMetadata JSON -> 400", func(t *testing.T) {
		ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create?id=ok-hub&hubMetadata=not-json")
		if !h.validateHubCreateParams(ctx, "ok-hub") {
			t.Fatal("malformed hubMetadata: helper returned false, want true (rejection written)")
		}
		if got := ctx.Response.StatusCode(); got != fasthttp.StatusBadRequest {
			t.Fatalf("status = %d, want 400", got)
		}
		if body := string(ctx.Response.Body()); !strings.Contains(body, "must be JSON") {
			t.Fatalf("body = %q, want 'must be JSON'", body)
		}
	})
}

// TestValidateHubCreateParamsAcceptsClean pins the happy path: a valid,
// in-cap id and hubMetadata pass all checks, the helper returns false, and
// no response is written.
func TestValidateHubCreateParamsAcceptsClean(t *testing.T) {
	h := newTestHandler()

	// hubMetadata valid JSON, under the cap.
	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create?id=clean-hub&hubMetadata=%7B%22name%22%3A%22test%22%7D")
	if h.validateHubCreateParams(ctx, "clean-hub") {
		t.Fatalf("clean params: helper returned true, want false; status=%d body=%q",
			ctx.Response.StatusCode(), string(ctx.Response.Body()))
	}
	// No response body written by the validation pass: a fresh
	// fasthttp.Response has an empty body (and reports 200, not 0, for an
	// unset status), so the empty body is what proves nothing was written.
	if len(ctx.Response.Body()) != 0 {
		t.Fatalf("clean params: expected no written body, got %q", string(ctx.Response.Body()))
	}

	// No hubMetadata at all is also acceptable (absent -> treated as empty
	// by the JSON check, and empty passes the size check).
	ctx = newRequestCtx("http://127.0.0.1/v1/hubs/create?id=clean-hub")
	if h.validateHubCreateParams(ctx, "clean-hub") {
		t.Fatalf("clean id, absent hubMetadata: helper returned true, want false")
	}
}

// TestValidateHubCreateParamsOrderingPinned verifies the canonical check
// order by feeding one ctx that violates the last check (malformed JSON)
// while an earlier check's input is also present — the 400 for the JSON
// shape must win, proving the JSON check runs last. And a value that is
// both oversized and malformed gets the 413, proving size runs before
// shape (the DoS guard).
func TestValidateHubCreateParamsOrderingPinned(t *testing.T) {
	h := newTestHandler()

	// oversized AND malformed: the 413 (size) must beat the 400 (shape).
	ctx := newRequestCtx("http://127.0.0.1/v1/hubs/create?id=ok&hubMetadata=" + oversizedValue)
	if !h.validateHubCreateParams(ctx, "ok") {
		t.Fatal("helper returned false, want true (rejection written)")
	}
	if got := ctx.Response.StatusCode(); got != fasthttp.StatusRequestEntityTooLarge {
		t.Fatalf("oversized+malformed hubMetadata: status = %d, want 413 (size before shape)", got)
	}
	if body := string(ctx.Response.Body()); strings.Contains(body, "must be JSON") {
		t.Fatalf("body = %q, want the 413 size error, not the 400 shape error", body)
	}

	// valid shape but oversized id: the id 413 must beat a would-be JSON
	// pass. (id is checked before hubMetadata.)
	oversizedID := strings.Repeat("a", config.MaxMetadataSize+1)
	ctx = newRequestCtx("http://127.0.0.1/v1/hubs/create?id=x&hubMetadata=%7B%22a%22%3A1%7D")
	if !h.validateHubCreateParams(ctx, oversizedID) {
		t.Fatal("helper returned false, want true (rejection written)")
	}
	if got := ctx.Response.StatusCode(); got != fasthttp.StatusRequestEntityTooLarge {
		t.Fatalf("oversized id + valid JSON: status = %d, want 413", got)
	}
	if body := string(ctx.Response.Body()); strings.Contains(body, "hubMetadata") {
		t.Fatalf("body = %q, want the id size error, not the hubMetadata error", body)
	}
}
