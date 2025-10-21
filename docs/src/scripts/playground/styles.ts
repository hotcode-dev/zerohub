export const playgroundStyle = `@import "tailwindcss";
.btn {
  @apply font-bold py-2 px-4 rounded;
}
.btn-blue {
  @apply bg-blue-500 text-white;
}
.btn-blue:hover {
  @apply bg-blue-700;
}
.videos-grid {
  display: grid;
  grid-template-rows: 100px;
  grid-auto-rows: 100px;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 10px;
}
:global(.videos-grid > video) {
  border: 2px dashed coral;
  background-color: lightseagreen;
}`;
