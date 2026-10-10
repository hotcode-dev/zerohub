package handler

import (
	"encoding/base64"
	"encoding/json"
	"testing"

	"github.com/valyala/fasthttp"
)

// checkAdminAuthResponse asserts that the response is a 401 with the
// "invalid authorization code" JSON body, i.e. CheckAdminAuth took its
// rejection path (Serve in handler.go keeps exactly that body for
// errAdminUnauthorized).
func checkAdminAuthResponse(t *testing.T, status int, body []byte) {
	t.Helper()

	if status != fasthttp.StatusUnauthorized {
		t.Fatalf("auth rejection status = %d, want %d", status, fasthttp.StatusUnauthorized)
	}
	var parsed struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatalf("auth rejection body %q is not valid JSON: %v", body, err)
	}
	if parsed.Error != "invalid authorization code" {
		t.Fatalf("auth rejection body error = %q, want %q", parsed.Error, "invalid authorization code")
	}
}

// TestCheckAdminAuthValidSecret verifies that the configured secret passes
// CheckAdminAuth and the guarded endpoint proceeds (200 from Migrate with a
// valid host).
func TestCheckAdminAuthValidSecret(t *testing.T) {
	h := newTestHandler()
	addr := startTestServer(t, h)
	client := newTestClient(addr)

	status, _, reqErr := doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost,
		map[string]string{"Authorization": adminAuthHeader()})
	if reqErr != nil || status != fasthttp.StatusOK {
		t.Fatalf("migrate with valid secret = (%d, %v), want 200", status, reqErr)
	}
}

// TestCheckAdminAuthWrongSecret verifies that a secret sharing a long prefix
// with the real one (the timing-attack case) is rejected with 401.
func TestCheckAdminAuthWrongSecret(t *testing.T) {
	h := newTestHandler()
	addr := startTestServer(t, h)
	client := newTestClient(addr)

	// Longest possible wrong prefix of the test secret, differing only in
	// the last byte.
	wrong := []byte(testClientSecret)
	wrong[len(wrong)-1] = wrong[len(wrong)-1] + 1
	status, body, reqErr := doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost,
		map[string]string{"Authorization": base64.StdEncoding.EncodeToString(wrong)})
	if reqErr != nil {
		t.Fatalf("migrate with wrong secret: %v", reqErr)
	}
	checkAdminAuthResponse(t, status, body)
	if h.isMigrating.Load() {
		t.Fatal("isMigrating is true after a wrong-secret request; want false")
	}
}

// TestCheckAdminAuthEmptyAuthorization verifies that an empty Authorization
// header (decodes to an empty string without a base64 error) is rejected
// with 401.
func TestCheckAdminAuthEmptyAuthorization(t *testing.T) {
	h := newTestHandler()
	addr := startTestServer(t, h)
	client := newTestClient(addr)

	status, body, reqErr := doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost,
		map[string]string{"Authorization": ""})
	if reqErr != nil {
		t.Fatalf("migrate with empty Authorization: %v", reqErr)
	}
	checkAdminAuthResponse(t, status, body)
}

// TestCheckAdminAuthMalformedBase64 verifies that a value that is not valid
// standard base64 is rejected with 401 at the decode step.
func TestCheckAdminAuthMalformedBase64(t *testing.T) {
	h := newTestHandler()
	addr := startTestServer(t, h)
	client := newTestClient(addr)

	status, body, reqErr := doRequest(t, client, "/v1/admin/migrate?host="+testBackupHost,
		map[string]string{"Authorization": "###not-base64###"})
	if reqErr != nil {
		t.Fatalf("migrate with malformed base64 Authorization: %v", reqErr)
	}
	checkAdminAuthResponse(t, status, body)
}
