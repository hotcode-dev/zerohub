package handler

import (
	"encoding/base64"
	"fmt"

	"github.com/rs/zerolog/log"
	"github.com/valyala/fasthttp"
)

func (h *handler) CheckAdminAuth(ctx *fasthttp.RequestCtx) error {
	authCode, err := base64.StdEncoding.DecodeString(string(ctx.Request.Header.Peek("Authorization")))
	if err != nil {
		log.Error().Err(fmt.Errorf("error decoding authorization code: %w", err)).Send()
		return h.Response(ctx, fasthttp.StatusUnauthorized, map[string]string{"error": "invalid authorization code"})
	}
	if string(authCode) != h.clientSecret {
		log.Error().Err(fmt.Errorf("invalid authorization code")).Send()
		return h.Response(ctx, fasthttp.StatusUnauthorized, map[string]string{"error": "invalid authorization code"})
	}
	return nil
}
