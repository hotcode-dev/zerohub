package handler

import (
	"fmt"
	"os"
	"testing"

	"gopkg.in/yaml.v3"
)

// These tests pin the plain-HTTP modeling of the hub-metadata read
// endpoints (/v1/hubs/get, /v1/random-hubs/get) in server/api.yml — the
// AsyncAPI contract AGENTS.md requires keeping aligned with
// pkg/handler/handler.go routing. The GetHub handler (get_hub.go) never
// upgrades the connection and answers a single JSON body, so the spec must
// model the two read channels as plain-HTTP channels (http binding, admin
// servers, empty request payload, JSON `hub` response) — not as WebSocket
// signaling channels carrying protobuf ClientMessage/ServerMessage payloads.

// specPath resolves api.yml relative to this package.
func specPath() string {
	return "../../api.yml"
}

// loadSpec parses the AsyncAPI YAML document and returns its root mapping.
func loadSpec(t *testing.T) *yaml.Node {
	t.Helper()
	data, err := os.ReadFile(specPath())
	if err != nil {
		t.Fatalf("reading api.yml: %v", err)
	}
	var root yaml.Node
	if err := yaml.Unmarshal(data, &root); err != nil {
		t.Fatalf("parsing api.yml: %v", err)
	}
	if root.Kind != yaml.DocumentNode || len(root.Content) != 1 {
		t.Fatalf("api.yml: expected a single YAML document, got %d top-level nodes", len(root.Content))
	}
	return root.Content[0]
}

// child returns the value node for key in a mapping node (t.Fatalf if absent).
func child(t *testing.T, m *yaml.Node, key string) *yaml.Node {
	t.Helper()
	if m.Kind != yaml.MappingNode {
		t.Fatalf("expected mapping, got kind %v", m.Kind)
	}
	for i := 0; i < len(m.Content); i += 2 {
		if m.Content[i].Value == key {
			return m.Content[i+1]
		}
	}
	t.Fatalf("key %q not found in mapping", key)
	return nil
}

// lookup returns the node at a key path, or an error when a key is absent
// (callers use this to assert absence without t.Fatalf).
func lookup(m *yaml.Node, path ...string) (*yaml.Node, error) {
	if m.Kind != yaml.MappingNode {
		return nil, fmt.Errorf("expected mapping, got kind %v", m.Kind)
	}
	cur := m
	for _, p := range path {
		found := false
		for i := 0; i < len(cur.Content); i += 2 {
			if cur.Content[i].Value == p {
				cur = cur.Content[i+1]
				found = true
				break
			}
		}
		if !found {
			return nil, fmt.Errorf("key %q not found", p)
		}
	}
	return cur, nil
}

// assertAbsent fails the test if the key path exists.
func assertAbsent(t *testing.T, m *yaml.Node, path ...string) {
	t.Helper()
	if node, err := lookup(m, path...); err == nil {
		t.Fatalf("%v: unexpectedly present: %v", path, node.Value)
	}
}

// TestGetHubChannelsArePlainHTTP pins the channel modeling: both read
// endpoints must be plain-HTTP channels scoped to the admin HTTP servers,
// with an empty-payload request message and a JSON `hub` response message —
// never a ws binding or the protobuf signaling messages.
func TestGetHubChannelsArePlainHTTP(t *testing.T) {
	root := loadSpec(t)
	channels := child(t, root, "channels")

	want := map[string]string{
		"hubsGet":       "/v1/hubs/get",
		"randomHubsGet": "/v1/random-hubs/get",
	}
	for name, address := range want {
		ch := child(t, channels, name)

		if got := child(t, ch, "address").Value; got != address {
			t.Fatalf("%s: address = %q, want %q", name, got, address)
		}

		bindings := child(t, ch, "bindings")
		if ws, err := lookup(bindings, "ws"); err == nil {
			t.Fatalf("%s: still carries a ws binding (%v); the get endpoint never upgrades the connection", name, ws.Value)
		}
		if http := child(t, bindings, "http"); http.Kind != yaml.MappingNode {
			t.Fatalf("%s: http binding must be the empty mapping, got %v (%v)", name, http.Value, http.Kind)
		}

		servers := child(t, ch, "servers")
		if servers.Kind != yaml.SequenceNode || len(servers.Content) != 2 {
			t.Fatalf("%s: servers = %v, want exactly two refs", name, servers.Value)
		}
		for i, refNode := range servers.Content {
			ref := child(t, refNode, "$ref").Value
			wantRef := fmt.Sprintf("#/servers/admin-%s", []string{"local", "production"}[i])
			if ref != wantRef {
				t.Fatalf("%s: servers[%d] $ref = %q, want %q", name, i, ref, wantRef)
			}
		}

		msgs := child(t, ch, "messages")
		assertAbsent(t, msgs, "clientMessage")
		assertAbsent(t, msgs, "serverMessage")
		if ref := child(t, child(t, msgs, "getHubRequest"), "$ref").Value; ref != "#/components/messages/HubGetRequest" {
			t.Fatalf("%s: getHubRequest $ref = %q, want #/components/messages/HubGetRequest", name, ref)
		}
		if ref := child(t, child(t, msgs, "hub"), "$ref").Value; ref != "#/components/messages/HubInfo" {
			t.Fatalf("%s: hub $ref = %q, want #/components/messages/HubInfo", name, ref)
		}
	}
}

// TestGetHubOperationsAreHTTP pins the operation modeling: the four get
// operations must exist as send/receive pairs against the JSON messages,
// and the old WebSocket-signal operation names must be gone.
func TestGetHubOperationsAreHTTP(t *testing.T) {
	root := loadSpec(t)
	ops := child(t, root, "operations")

	for _, name := range []string{
		"clientSendOnHubsGet", "clientReceiveOnHubsGet",
		"clientSendOnRandomHubsGet", "clientReceiveOnRandomHubsGet",
	} {
		assertAbsent(t, ops, name)
	}

	wantOps := map[string]struct {
		action  string
		channel string
		message string
	}{
		"adminSendOnHubsGet":          {"send", "hubsGet", "getHubRequest"},
		"adminReceiveOnHubsGet":       {"receive", "hubsGet", "hub"},
		"adminSendOnRandomHubsGet":    {"send", "randomHubsGet", "getHubRequest"},
		"adminReceiveOnRandomHubsGet": {"receive", "randomHubsGet", "hub"},
	}
	for name, w := range wantOps {
		op := child(t, ops, name)
		if got := child(t, op, "action").Value; got != w.action {
			t.Fatalf("%s: action = %q, want %q", name, got, w.action)
		}
		if ref := child(t, child(t, op, "channel"), "$ref").Value; ref != "#/channels/"+w.channel {
			t.Fatalf("%s: channel $ref = %q, want #/channels/%s", name, ref, w.channel)
		}
		msgs := child(t, op, "messages")
		if msgs.Kind != yaml.SequenceNode || len(msgs.Content) != 1 {
			t.Fatalf("%s: messages = %v, want exactly one ref", name, msgs.Value)
		}
		if ref := child(t, msgs.Content[0], "$ref").Value; ref != "#/channels/"+w.channel+"/messages/"+w.message {
			t.Fatalf("%s: messages[0] $ref = %q, want #/channels/%s/messages/%s", name, ref, w.channel, w.message)
		}
	}
}

// TestGetHubMessagesAndSchemas pins the component definitions: HubGetRequest
// must carry an empty (null) payload, HubInfo must reference the Hub schema,
// and the Hub schema must match the JSON the GetHub handler actually writes
// (id, createdAt, metadata, isPermanent).
func TestGetHubMessagesAndSchemas(t *testing.T) {
	root := loadSpec(t)
	messages := child(t, child(t, root, "components"), "messages")

	req := child(t, messages, "HubGetRequest")
	if ct := child(t, req, "contentType").Value; ct != "application/json" {
		t.Fatalf("HubGetRequest: contentType = %q, want application/json", ct)
	}
	payload := child(t, req, "payload")
	if payload.Kind != yaml.MappingNode {
		t.Fatalf("HubGetRequest: payload must be the {type: null} mapping, got %v (%v)", payload.Value, payload.Kind)
	}
	if typ := child(t, payload, "type").Value; typ != "null" {
		t.Fatalf("HubGetRequest: payload type = %q, want null (empty request; the id rides on the URL)", typ)
	}

	resp := child(t, messages, "HubInfo")
	if ref := child(t, child(t, resp, "payload"), "$ref").Value; ref != "#/components/schemas/Hub" {
		t.Fatalf("HubInfo: payload $ref = %q, want #/components/schemas/Hub", ref)
	}

	schemas := child(t, child(t, root, "components"), "schemas")
	hub := child(t, schemas, "Hub")
	props, err := lookup(hub, "properties")
	if err != nil {
		t.Fatalf("Hub schema: properties: %v", err)
	}
	for _, field := range []string{"id", "createdAt", "metadata", "isPermanent"} {
		if _, err := lookup(props, field); err != nil {
			t.Fatalf("Hub schema: property %q not found: %v", field, err)
		}
	}
	// The peer roster is NOT part of the read response (the handler returns
	// the hub value, not a peer listing) — pin that too.
	assertAbsent(t, props, "peers")

	required, err := lookup(hub, "required")
	if err != nil {
		t.Fatalf("Hub schema: required: %v", err)
	}
	if required.Kind != yaml.SequenceNode {
		t.Fatalf("Hub schema: required must be a sequence, got kind %v", required.Kind)
	}
	have := map[string]bool{}
	for _, item := range required.Content {
		have[item.Value] = true
	}
	for _, field := range []string{"id", "createdAt", "metadata", "isPermanent"} {
		if !have[field] {
			t.Fatalf("Hub schema: required missing %q (have %v)", field, have)
		}
	}
}
