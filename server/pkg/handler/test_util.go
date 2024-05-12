package handler

import (
	"net/http"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/hotcode-dev/zerohub/pkg/config"
	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
	"go.uber.org/mock/gomock"
)

// testData struct for handler test
type testData struct {
	name        string
	request     func() *http.Request
	mockZeroHub func(zerohubMock *zerohub.MockZeroHub) zerohub.ZeroHub
	wantStatus  int
}

// mockHandlerAndTest create mock handler and gin context
func mockHandlerAndTest(test testData, mockCtrl *gomock.Controller) (*handler, *fasthttp.Server) {
	// initial handler function and mock
	h := &handler{
		clientSecret: "change_this_salt",
	}
	if test.mockZeroHub != nil {
		zerohubMock := zerohub.NewMockZeroHub(mockCtrl)
		h.zh = test.mockZeroHub(zerohubMock)
	}

	server := &fasthttp.Server{
		Name:               "ZeroHub",
		MaxRequestBodySize: config.HTTPMaxRequestBodySize,
	}

	return h, server
}

// validateResponse check diff data response and error response, fatal when unmatched
func validateResponse(
	t *testing.T,
	test testData,
	status int,
) {
	// validate data response
	if diff := cmp.Diff(
		test.wantStatus,
		status,
	); diff != "" {
		t.Fatalf("want data mismatch(-want +got):\n%s", diff)
	}
}
