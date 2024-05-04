package handler

import (
	"fmt"

	"github.com/bytedance/sonic"
	"github.com/valyala/fasthttp"
)

func (h *handler) Response(ctx *fasthttp.RequestCtx, statusCode int, body interface{}) error {
	data, err := sonic.Marshal(body)
	if err != nil {
		ctx.SetStatusCode(fasthttp.StatusInternalServerError)
		return fmt.Errorf("error to marshal json: %w", err)
	}

	ctx.SetStatusCode(statusCode)
	ctx.SetBody(data)
	return nil
}
