package handler

import (
	"testing"

	"gopkg.in/yaml.v3"
)

// These tests pin the plain-HTTP admin endpoint modeling of
// /v1/permanent-hubs/create in server/api.yml — the AsyncAPI contract
// AGENTS.md requires keeping aligned with
// pkg/handler/create_hub_permanent.go. The handler answers a single JSON
// success body (hub.go: id, createdAt, metadata, isPermanent) and JSON
// error bodies 400/401/409/413/500, all of the shape {"error": "..."}
// (plus a 301 with a distinct body while migrating, described on the
// channel). The spec must wire that error contract onto the operation:
// a createError channel message carrying the PermanentHubCreateError
// schema, referenced by the receive operation alongside the success
// message, so the schema is not dead spec content.

// TestPermanentHubsCreateChannelMessages pins the channel's message block:
// createRequest/createdHub (unchanged) plus the createError message that
// carries the error-body schema.
func TestPermanentHubsCreateChannelMessages(t *testing.T) {
	root := loadSpec(t)
	ch := child(t, child(t, root, "channels"), "permanentHubsCreate")

	if got := child(t, ch, "address").Value; got != "/v1/permanent-hubs/create" {
		t.Fatalf("permanentHubsCreate: address = %q", got)
	}

	msgs := child(t, ch, "messages")
	want := map[string]string{
		"createRequest": "#/components/messages/PermanentHubCreateRequest",
		"createdHub":    "#/components/messages/PermanentHubCreated",
		"createError":   "#/components/messages/PermanentHubCreateError",
	}
	for name, wantRef := range want {
		msg := child(t, msgs, name)
		if ref := child(t, msg, "$ref").Value; ref != wantRef {
			t.Fatalf("permanentHubsCreate.messages.%s $ref = %q, want %q", name, ref, wantRef)
		}
	}
}

// TestPermanentHubsCreateErrorMessageAndSchema pins the error message
// component: JSON content type and a payload that references the
// PermanentHubCreateError schema, which models exactly the {"error": ...}
// bodies the handler writes.
func TestPermanentHubsCreateErrorMessageAndSchema(t *testing.T) {
	root := loadSpec(t)
	messages := child(t, child(t, root, "components"), "messages")
	msg := child(t, messages, "PermanentHubCreateError")

	if ct := child(t, msg, "contentType").Value; ct != "application/json" {
		t.Fatalf("PermanentHubCreateError: contentType = %q, want application/json", ct)
	}
	if ref := child(t, child(t, msg, "payload"), "$ref").Value; ref != "#/components/schemas/PermanentHubCreateError" {
		t.Fatalf("PermanentHubCreateError: payload $ref = %q, want #/components/schemas/PermanentHubCreateError", ref)
	}

	schema := child(t, child(t, child(t, root, "components"), "schemas"), "PermanentHubCreateError")
	errProp, err := lookup(schema, "properties", "error")
	if err != nil {
		t.Fatalf("PermanentHubCreateError schema: properties.error: %v", err)
	}
	if typ := child(t, errProp, "type").Value; typ != "string" {
		t.Fatalf("PermanentHubCreateError schema: error type = %q, want string", typ)
	}
	required, err := lookup(schema, "required")
	if err != nil {
		t.Fatalf("PermanentHubCreateError schema: required: %v", err)
	}
	if required.Kind != yaml.SequenceNode || len(required.Content) != 1 || required.Content[0].Value != "error" {
		t.Fatalf("PermanentHubCreateError schema: required = %v, want exactly [error]", required.Value)
	}
}

// TestPermanentHubsCreateOperationWiring pins the receive operation: it
// must reference BOTH the success and error channel messages, and its
// x-asyncapi-errors extension (AsyncAPI 3.1.0 has no `errors` keyword on
// operations) must list exactly the status codes create_hub_permanent.go
// can answer: 400, 401, 409, 413, 500 — each carried on the createError
// message.
func TestPermanentHubsCreateOperationWiring(t *testing.T) {
	root := loadSpec(t)
	op := child(t, child(t, root, "operations"), "adminReceiveOnPermanentHubsCreate")

	if got := child(t, op, "action").Value; got != "receive" {
		t.Fatalf("adminReceiveOnPermanentHubsCreate: action = %q, want receive", got)
	}
	if ref := child(t, child(t, op, "channel"), "$ref").Value; ref != "#/channels/permanentHubsCreate" {
		t.Fatalf("adminReceiveOnPermanentHubsCreate: channel $ref = %q", ref)
	}

	msgs := child(t, op, "messages")
	wantRefs := []string{
		"#/channels/permanentHubsCreate/messages/createdHub",
		"#/channels/permanentHubsCreate/messages/createError",
	}
	if msgs.Kind != yaml.SequenceNode || len(msgs.Content) != len(wantRefs) {
		t.Fatalf("adminReceiveOnPermanentHubsCreate: messages = %v, want exactly %d refs", msgs.Value, len(wantRefs))
	}
	seen := map[string]bool{}
	for _, item := range msgs.Content {
		seen[child(t, item, "$ref").Value] = true
	}
	for _, wantRef := range wantRefs {
		if !seen[wantRef] {
			t.Fatalf("adminReceiveOnPermanentHubsCreate: messages missing %q (have %v)", wantRef, seen)
		}
	}

	// The 301 migrating response is not part of this extension: its body
	// differs from {"error": ...} and it is described on the channel.
	errs := child(t, op, "x-asyncapi-errors")
	wantStatuses := map[string]bool{"400": true, "401": true, "409": true, "413": true, "500": true}
	if errs.Kind != yaml.SequenceNode || len(errs.Content) != len(wantStatuses) {
		t.Fatalf("adminReceiveOnPermanentHubsCreate: x-asyncapi-errors = %v, want exactly 5 entries", errs.Value)
	}
	seenStatuses := map[string]bool{}
	const wantMsg = "#/channels/permanentHubsCreate/messages/createError"
	for _, item := range errs.Content {
		status := child(t, item, "status").Value
		msg := child(t, item, "message").Value
		if msg != wantMsg {
			t.Fatalf("x-asyncapi-errors[status=%s]: message = %q, want %q", status, msg, wantMsg)
		}
		seenStatuses[status] = true
	}
	for status := range wantStatuses {
		if !seenStatuses[status] {
			t.Fatalf("x-asyncapi-errors missing status %s (have %v)", status, seenStatuses)
		}
	}
}

// TestPermanentHubsCreateSuccessSchemaUnchanged pins the success contract:
// the PermanentHubCreated schema must keep matching the JSON tags on the
// hub struct in pkg/hub/hub.go (id, createdAt, metadata, isPermanent).
func TestPermanentHubsCreateSuccessSchemaUnchanged(t *testing.T) {
	root := loadSpec(t)
	schema := child(t, child(t, child(t, root, "components"), "schemas"), "PermanentHubCreated")

	props, err := lookup(schema, "properties")
	if err != nil {
		t.Fatalf("PermanentHubCreated schema: properties: %v", err)
	}
	want := map[string]string{
		"id":          "string",
		"createdAt":   "string",
		"metadata":    "string",
		"isPermanent": "boolean",
	}
	for field, typ := range want {
		prop, err := lookup(props, field)
		if err != nil {
			t.Fatalf("PermanentHubCreated schema: property %q not found: %v", field, err)
		}
		if got := child(t, prop, "type").Value; got != typ {
			t.Fatalf("PermanentHubCreated schema: %s type = %q, want %q", field, got, typ)
		}
	}

	required, err := lookup(schema, "required")
	if err != nil {
		t.Fatalf("PermanentHubCreated schema: required: %v", err)
	}
	have := map[string]bool{}
	for _, item := range required.Content {
		have[item.Value] = true
	}
	for field := range want {
		if !have[field] {
			t.Fatalf("PermanentHubCreated schema: required missing %q (have %v)", field, have)
		}
	}
	// Exactly these four fields — no more, no fewer — mirror the hub.go
	// JSON tags.
	if len(have) != len(want) {
		t.Fatalf("PermanentHubCreated schema: required has extra fields %v (want exactly %d)", have, len(want))
	}
}

// TestNoOrphanedPermanentHubComponents pins that the PermanentHubCreateError
// schema and message are each referenced by at least one local $ref: this is
// the regression guard for the dead-spec-content this task removes.
func TestNoOrphanedPermanentHubComponents(t *testing.T) {
	root := loadSpec(t)
	refs := []string{}
	collectRefs(root, &refs)

	refSet := map[string]bool{}
	for _, r := range refs {
		refSet[r] = true
	}
	for _, target := range []string{
		"#/components/schemas/PermanentHubCreateError",
		"#/components/messages/PermanentHubCreateError",
	} {
		if !refSet[target] {
			t.Fatalf("%s is defined but not referenced anywhere in api.yml (orphaned)", target)
		}
	}
}

// collectRefs walks a YAML tree and appends every local $ref string.
func collectRefs(node *yaml.Node, refs *[]string) {
	if node == nil {
		return
	}
	if node.Kind == yaml.MappingNode {
		for i := 0; i < len(node.Content); i += 2 {
			k, v := node.Content[i], node.Content[i+1]
			if k.Value == "$ref" {
				*refs = append(*refs, v.Value)
			}
			collectRefs(v, refs)
		}
		return
	}
	for _, c := range node.Content {
		collectRefs(c, refs)
	}
}
