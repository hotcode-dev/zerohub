package handler

import (
	"encoding/json"
	"fmt"

	"github.com/valyala/fasthttp"
)

// Response is a helper function to write a JSON response to the client.
func (h *handler) Response(ctx *fasthttp.RequestCtx, statusCode int, body interface{}) error {
	data, err := json.Marshal(body)
	if err != nil {
		ctx.SetStatusCode(fasthttp.StatusInternalServerError)
		return fmt.Errorf("error to marshal json: %w", err)
	}

	ctx.SetStatusCode(statusCode)
	ctx.SetBody(data)
	return nil
}
