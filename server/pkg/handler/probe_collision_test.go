package handler

import (
	"strings"
	"testing"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
)

// TestProbeSiblingsForCollision pins the behavior of the shared cross-mode
// probe helper that both claimUserChosenHubId and claimGetOrCreateHub call:
// on a hit it writes the 409 collision body and reports rejected=true,
// nil siblings are skipped without panicking, and a free id reports
// rejected=false with no response written.
func TestProbeSiblingsForCollision(t *testing.T) {
	holder := newRealZeroHub(t)
	other := newRealZeroHub(t)
	// Seed the holder so the id is taken in exactly one sibling.
	if _, _, err := holder.GetOrCreateHub("probe-collide", `{"name":"seed"}`, false); err != nil {
		t.Fatalf("seed GetOrCreateHub: %v", err)
	}

	h := newTestHandler()

	// Hit: holder first in the slice.
	ctx := newRequestCtx("http://127.0.0.1/v1/random-hubs/create?id=probe-collide")
	if !h.probeSiblingsForCollision(ctx, "probe-collide", []zerohub.ZeroHub{holder}) {
		t.Fatalf("probe rejected=false, want true (sibling holds the id)")
	}
	if code := ctx.Response.StatusCode(); code != fasthttp.StatusConflict {
		t.Errorf("status = %d, want %d", code, fasthttp.StatusConflict)
	}
	if body := string(ctx.Response.Body()); !strings.Contains(body, "hub id collides with another hub type") {
		t.Errorf("body = %q, want the collision error", body)
	}

	// Hit with a nil sibling before the holder: nil must be skipped,
	// not treated as a holder.
	ctx = newRequestCtx("http://127.0.0.1/v1/random-hubs/create?id=probe-collide")
	if !h.probeSiblingsForCollision(ctx, "probe-collide", []zerohub.ZeroHub{nil, holder}) {
		t.Fatalf("probe with nil prefix rejected=false, want true")
	}
	if code := ctx.Response.StatusCode(); code != fasthttp.StatusConflict {
		t.Errorf("status = %d, want %d", code, fasthttp.StatusConflict)
	}

	// Miss: a sibling that does not hold the id.
	ctx = newRequestCtx("http://127.0.0.1/v1/random-hubs/create?id=probe-collide")
	if h.probeSiblingsForCollision(ctx, "probe-collide", []zerohub.ZeroHub{nil, other}) {
		t.Fatalf("probe rejected=true, want false (no sibling holds the id)")
	}
	if len(ctx.Response.Body()) != 0 {
		t.Errorf("response written on a clean probe: %q", string(ctx.Response.Body()))
	}

	// Miss: no siblings at all.
	ctx = newRequestCtx("http://127.0.0.1/v1/random-hubs/create?id=probe-collide")
	if h.probeSiblingsForCollision(ctx, "probe-collide", nil) {
		t.Fatalf("probe rejected=true for empty sibling list, want false")
	}
}

// TestIPFromForwardedHeader pins the X-Forwarded-For parsing in
// ipFromForwardedHeader (currently strings.Cut): absent header, single
// entry, multi-entry (first/outermost wins), whitespace-padded entry, and
// unparseable garbage all behave as documented.
func TestIPFromForwardedHeader(t *testing.T) {
	cases := []struct {
		name string
		xff  string // "" = header not set
		want string
	}{
		{"absent", "", ""},
		{"single", "203.0.113.7", "203.0.113.7"},
		{"multi", "203.0.113.7, 10.0.0.1, 10.0.0.2", "203.0.113.7"},
		{"whitespace", "  198.51.100.4  , 10.0.0.1", "198.51.100.4"},
		{"garbage-first", "not-an-ip, 203.0.113.7", ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := newRequestCtx("http://127.0.0.1/v1/status")
			if tc.xff != "" {
				ctx.Request.Header.Set("X-Forwarded-For", tc.xff)
			}
			if got := ipFromForwardedHeader(ctx); got != tc.want {
				t.Fatalf("ipFromForwardedHeader(%q) = %q, want %q", tc.xff, got, tc.want)
			}
		})
	}
}
