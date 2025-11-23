# spawn 3 processes
MAKEFLAGS += -j3

.PHONY: default
default: server-serve

test-all: server-test e2e-test

proto-gen:
	api-linter ./proto/zerohub/v1/*.proto
	rm -rf ./client/src/proto && rm -rf ./pkg/proto
	protoc --plugin=./client/node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./client/src --go_out=./server/pkg --go_opt=paths=source_relative ./proto/zerohub/v1/*.proto

server-serve:
	cd server && APP_CLIENT_SECRET=client_secret go run ./cmd/server.go

server-serve-2:
	cd server && APP_PORT=8081 go run ./cmd/server.go

server-mock:
	# Reflex mode read ZeroHub mock
	cd server && mockgen -source=./pkg/zerohub/zerohub.go -destination ./pkg/zerohub/mock.go -package zerohub -self_package github.com/hotcode-dev/zerohub/pkg/zerohub ZeroHub
	cd server && mockgen -source=./pkg/hub/hub.go -destination ./pkg/hub/mock.go -package hub -self_package github.com/hotcode-dev/zerohub/pkg/hub /pkg/hub Hub
	cd server && mockgen -source=./pkg/peer/peer.go -destination ./pkg/peer/mock.go -package peer -self_package github.com/hotcode-dev/zerohub/pkg/peer /pkg/peer Peer

server-test:
	cd server && go test -v ./...

server-bench:
	cd server && go test -bench ./pkg/*** -benchmem -benchtime=1000x

client-build:
	cd ./client && npm run build

kill-server:
	@PIDS=$$(lsof -ti:8080 -sTCP:LISTEN 2>/dev/null); \
	if [ -n "$$PIDS" ]; then kill $$PIDS 2>/dev/null || true; fi
	@PIDS=$$(lsof -ti:8081 -sTCP:LISTEN 2>/dev/null); \
	if [ -n "$$PIDS" ]; then kill $$PIDS 2>/dev/null || true; fi

e2e-test:
	$(MAKE) kill-server >/dev/null 2>&1 || true; \
	( make server-serve ) & \
	SERVER1_PID=$$!; \
	( make server-serve-2 ) & \
	SERVER2_PID=$$!; \
	sleep 3; \
	( cd ./test && PWDEBUG=console npm run test ) || true; \
	kill $$SERVER1_PID $$SERVER2_PID 2>/dev/null || true; \
	wait $$SERVER1_PID $$SERVER2_PID 2>/dev/null || true; \
