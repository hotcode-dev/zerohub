package handler

import (
	"errors"
	"testing"

	"github.com/hotcode-dev/zerohub/pkg/zerohub"
	"github.com/valyala/fasthttp"
	"go.uber.org/mock/gomock"
)

func TestCreateHubByID_HandlesCleanupError(t *testing.T) {
	t.Run("removes hub on upgrade failure", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		// NewHub succeeds
		mockZeroHub.EXPECT().NewHub(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()

		// RemoveHubById succeeds (cleanup on upgrade failure)
		mockZeroHub.EXPECT().RemoveHubById(gomock.Any()).Return(nil).AnyTimes()

		h.zeroHub = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/hubs/create?peerMetadata=test")

		err := h.CreateHubByID(ctx, mockZeroHub, "test-hub")
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})

	t.Run("logs error when RemoveHubById fails", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		// NewHub succeeds
		mockZeroHub.EXPECT().NewHub(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()

		// RemoveHubById fails
		mockZeroHub.EXPECT().RemoveHubById(gomock.Any()).Return(errors.New("remove failed")).AnyTimes()

		h.zeroHub = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/hubs/create?peerMetadata=test")

		err := h.CreateHubByID(ctx, mockZeroHub, "test-hub")
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

func TestJoinOrCreateHubByID_ErrorHandling(t *testing.T) {
	t.Run("joins existing hub and upgrades", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		mockZeroHub.EXPECT().GetHubById(gomock.Any()).Return(nil).AnyTimes()

		h.zeroHub = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/hubs/join-or-create?peerMetadata=test")

		err := h.JoinOrCreateHubByID(ctx, mockZeroHub, "test-hub")
		if err != nil {
			t.Fatalf("expected nil, got %v", err)
		}
	})
}

func TestCreateHubStatic(t *testing.T) {
	t.Run("returns conflict when hub already exists", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		mockZeroHub.EXPECT().GetHubById(gomock.Any()).Return(nil)

		h.zeroHub = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/hubs/create?id=test-hub")

		err := h.CreateHubStatic(ctx, mockZeroHub)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

func TestCreateHubPermanent(t *testing.T) {
	t.Run("returns internal server error on new hub failure", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		h.zeroHubPermanent = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/permanent-hubs/create?peerMetadata=test")

		err := h.CreateHubPermanent(ctx)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

func TestUpgrade_ErrorHandling(t *testing.T) {
	t.Run("returns error when websocket upgrade fails", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")

		err := h.Upgrade(ctx, mockZeroHub, nil)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

// =============================================================================
// Additional error path tests for coverage
// =============================================================================

func TestCreateHubByID_HubCreationFails(t *testing.T) {
	t.Run("returns 500 when NewHub fails", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		// NewHub fails
		mockZeroHub.EXPECT().NewHub(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, errors.New("storage write error"))

		h.zeroHub = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/hubs/create?hubMetadata=test")

		err := h.CreateHubByID(ctx, mockZeroHub, "test-hub")
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})

	t.Run("removes hub on upgrade failure after successful NewHub", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		// NewHub succeeds
		mockZeroHub.EXPECT().NewHub(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil)

		// RemoveHubById succeeds (cleanup)
		mockZeroHub.EXPECT().RemoveHubById(gomock.Any()).Return(nil)

		h.zeroHub = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/hubs/create?hubMetadata=test")

		err := h.CreateHubByID(ctx, mockZeroHub, "test-hub")
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

func TestJoinOrCreateHubByID_CleanupOnError(t *testing.T) {
	t.Run("removes hub when creation and upgrade fail", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		// Hub doesn't exist yet
		mockZeroHub.EXPECT().GetHubById(gomock.Any()).Return(nil).AnyTimes()

		// NewHub succeeds
		mockZeroHub.EXPECT().NewHub(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil).AnyTimes()

		// RemoveHubById succeeds (cleanup)
		mockZeroHub.EXPECT().RemoveHubById(gomock.Any()).Return(nil).AnyTimes()

		h.zeroHub = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/hubs/join-or-create?hubMetadata=test")

		err := h.JoinOrCreateHubByID(ctx, mockZeroHub, "test-hub")
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})

	t.Run("does not remove existing hub when upgrade fails", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		// Hub already exists (not nil)
		mockZeroHub.EXPECT().GetHubById(gomock.Any()).Return(nil).Times(1)

		h.zeroHub = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/hubs/join-or-create?hubMetadata=test")

		err := h.JoinOrCreateHubByID(ctx, mockZeroHub, "existing-hub")
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

func TestCreateHubPermanent_HubExists(t *testing.T) {
	t.Run("returns conflict when permanent hub already exists", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		// Hub already exists
		mockZeroHub.EXPECT().GetHubById(gomock.Any()).Return(nil)

		h.zeroHubPermanent = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/permanent-hubs/create?id=test-hub")

		err := h.CreateHubPermanent(ctx)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

func TestCreateHubStatic_HubExists(t *testing.T) {
	t.Run("returns conflict when static hub already exists", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		// Hub already exists
		mockZeroHub.EXPECT().GetHubById(gomock.Any()).Return(nil)

		h.zeroHub = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/hubs/create?id=test-hub")

		err := h.CreateHubStatic(ctx, mockZeroHub)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

func TestJoinOrCreateHubByID_StorageWriteFails(t *testing.T) {
	t.Run("returns error when storage write fails during creation", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		// Hub doesn't exist
		mockZeroHub.EXPECT().GetHubById(gomock.Any()).Return(nil).AnyTimes()

		// NewHub fails with storage error
		mockZeroHub.EXPECT().NewHub(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, errors.New("storage write error"))

		h.zeroHub = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/hubs/join-or-create?hubMetadata=test")

		err := h.JoinOrCreateHubByID(ctx, mockZeroHub, "test-hub")
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}

func TestCreateHubPermanent_CleanupOnError(t *testing.T) {
	t.Run("cleanup when permanent hub creation succeeds but storage fails", func(t *testing.T) {
		ctrl := gomock.NewController(t)
		defer ctrl.Finish()

		h := &handler{}
		mockZeroHub := zerohub.NewMockZeroHub(ctrl)

		// Hub doesn't exist yet
		mockZeroHub.EXPECT().GetHubById(gomock.Any()).Return(nil)

		// NewHub succeeds
		mockZeroHub.EXPECT().NewHub(gomock.Any(), gomock.Any(), gomock.Any()).Return(nil, nil)

		h.zeroHubPermanent = mockZeroHub

		ctx := &fasthttp.RequestCtx{}
		ctx.Request.Header.SetMethod("GET")
		ctx.Request.SetRequestURI("/v1/permanent-hubs/create?id=test-hub")

		err := h.CreateHubPermanent(ctx)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
	})
}
