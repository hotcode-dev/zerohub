package handler

import (
	"encoding/base64"
	"errors"
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

// errAdminUnauthorized is returned by CheckAdminAuth when the request is not
// authorized. Callers must treat any non-nil error as a hard stop: no state
// may be mutated after an auth failure.
var errAdminUnauthorized = errors.New("admin authorization failed")

// CheckAdminAuth checks if the request is authorized to perform admin actions.
// On failure it writes the 401 JSON body AND returns a non-nil error so the
// caller can bail out without touching any state.
func (h *handler) CheckAdminAuth(ctx *fasthttp.RequestCtx) error {
	authCode, err := base64.StdEncoding.DecodeString(string(ctx.Request.Header.Peek("Authorization")))
	if err != nil {
		log.Error().Err(fmt.Errorf("error decoding authorization code: %w", err)).Send()
		_ = h.Response(ctx, fasthttp.StatusUnauthorized, map[string]string{"error": "invalid authorization code"})
		return errAdminUnauthorized
	}
	if string(authCode) != h.clientSecret {
		log.Error().Err(fmt.Errorf("invalid authorization code")).Send()
		_ = h.Response(ctx, fasthttp.StatusUnauthorized, map[string]string{"error": "invalid authorization code"})
		return errAdminUnauthorized
	}
	return nil
}
