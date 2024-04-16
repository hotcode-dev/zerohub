# spawn 3 processes
MAKEFLAGS += -j3

test-all: server-serve server-serve-2 e2e-test

proto-gen:
	rm -rf ./client/src/proto && rm -rf ./pkg/proto
	protoc --plugin=./client/node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./client/src --go_out=./server/pkg --go_opt=paths=source_relative ./proto/*.proto

server-serve:
	cd server && APP_CLIENT_SECRET=client_secret go run ./cmd/server.go

server-serve-2:
	cd server && APP_PORT=8081 go run ./cmd/server.go

client-build:
	cd ./client && npm run build

kill-server:
	-pkill -f "APP_CLIENT_SECRET=client_secret go run ./cmd/server.go"
	-pkill -f "APP_PORT=8081 go run ./cmd/server.go"

e2e-test:
	cd ./test && npm run test
