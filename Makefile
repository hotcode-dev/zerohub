
proto-gen:
	rm -rf ./client/src/proto && rm -rf ./pkg/proto
	protoc --plugin=./client/node_modules/.bin/protoc-gen-ts_proto --ts_proto_out=./client/src --go_out=./server/pkg --go_opt=paths=source_relative ./proto/*.proto

serve:
	cd server && go run ./cmd/server.go

client-build:
	cd client && npm run build
