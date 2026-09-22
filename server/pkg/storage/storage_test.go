package storage

import (
	"testing"
)

// backends is the list of storage backends under test.
var backends = []struct {
	Name    string
	Factory func() Storage[int]
}{
	{Name: "memory", Factory: NewMemoryStorage[int]},
	{Name: "gache", Factory: NewGacheStorage[int]},
}

func TestStorageAddGet(t *testing.T) {
	t.Parallel()

	for _, b := range backends {
		newStorage := b.Factory()

		t.Run(b.Name, func(t *testing.T) {
			t.Parallel()

			newStorage.Add("a", 1)
			newStorage.Add("b", 2)

			if v, err := newStorage.Get("a"); err != nil || v != 1 {
				t.Fatalf("Get(a) = %v, %v; want 1, nil", v, err)
			}

			if v, err := newStorage.Get("b"); err != nil || v != 2 {
				t.Fatalf("Get(b) = %v, %v; want 2, nil", v, err)
			}

			if _, err := newStorage.Get("missing"); err == nil {
				t.Fatal("Get(missing) = nil error; want not found")
			}
		})
	}
}

func TestStorageGetAll(t *testing.T) {
	t.Parallel()

	for _, b := range backends {
		newStorage := b.Factory()

		t.Run(b.Name, func(t *testing.T) {
			t.Parallel()

			want := map[int]struct{}{1: {}, 2: {}, 3: {}}

			for i, id := range []string{"a", "b", "c"} {
				newStorage.Add(id, i+1)
			}

			got := make(map[int]struct{})
			for v := range newStorage.GetAll() {
				got[v] = struct{}{}
			}

			if len(got) != len(want) {
				t.Fatalf("GetAll returned %d items; want %d", len(got), len(want))
			}

			for v := range want {
				if _, ok := got[v]; !ok {
					t.Fatalf("GetAll missing item %d; got %v", v, got)
				}
			}
		})
	}
}

func TestStorageUpdate(t *testing.T) {
	t.Parallel()

	for _, b := range backends {
		newStorage := b.Factory()

		t.Run(b.Name, func(t *testing.T) {
			t.Parallel()

			newStorage.Add("a", 1)
			newStorage.Update("a", 42)

			if v, err := newStorage.Get("a"); err != nil || v != 42 {
				t.Fatalf("Get(a) after Update = %v, %v; want 42, nil", v, err)
			}
		})
	}
}

func TestStorageDelete(t *testing.T) {
	t.Parallel()

	for _, b := range backends {
		newStorage := b.Factory()

		t.Run(b.Name, func(t *testing.T) {
			t.Parallel()

			// Regression: GacheStorage.Delete used to call Get, making
			// deletion a no-op (see zf-b11cc807).
			newStorage.Add("a", 1)
			newStorage.Delete("a")

			if _, err := newStorage.Get("a"); err == nil {
				t.Fatal("Get(a) after Delete succeeded; want not found")
			}

			if !newStorage.IsEmpty() {
				t.Fatal("IsEmpty after deleting the only item = false; want true")
			}

			// Deleting a missing key must not panic and must be a no-op.
			newStorage.Delete("missing")

			if !newStorage.IsEmpty() {
				t.Fatal("IsEmpty after deleting missing key = false; want true")
			}
		})
	}
}

func TestStorageDeletePartial(t *testing.T) {
	t.Parallel()

	for _, b := range backends {
		newStorage := b.Factory()

		t.Run(b.Name, func(t *testing.T) {
			t.Parallel()

			newStorage.Add("a", 1)
			newStorage.Add("b", 2)
			newStorage.Delete("a")

			if _, err := newStorage.Get("a"); err == nil {
				t.Fatal("Get(a) after Delete succeeded; want not found")
			}

			if v, err := newStorage.Get("b"); err != nil || v != 2 {
				t.Fatalf("Get(b) = %v, %v; want 2, nil", v, err)
			}

			if newStorage.IsEmpty() {
				t.Fatal("IsEmpty with remaining items = true; want false")
			}
		})
	}
}

func TestStorageIsEmpty(t *testing.T) {
	t.Parallel()

	for _, b := range backends {
		newStorage := b.Factory()

		t.Run(b.Name, func(t *testing.T) {
			t.Parallel()

			if !newStorage.IsEmpty() {
				t.Fatal("IsEmpty on new storage = false; want true")
			}

			newStorage.Add("a", 1)

			if newStorage.IsEmpty() {
				t.Fatal("IsEmpty after Add = true; want false")
			}
		})
	}
}
