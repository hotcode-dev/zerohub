# spawn 3 processes
MAKEFLAGS += -j3

test-all: server-serve server-serve2 client-test

proto-gen:
	rm -rf ./client/src/proto && rm -rf ./pkg/proto
	protoc --plugin=./client/node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./client/src --go_out=./server/pkg --go_opt=paths=source_relative ./proto/*.proto

server-serve:
	cd server && go run ./cmd/server.go

server-serve2:
	cd server && APP_PORT=8081 go run ./cmd/server.go

client-build:
	cd client && npm run build

client-test:
	cd client && npm run test
