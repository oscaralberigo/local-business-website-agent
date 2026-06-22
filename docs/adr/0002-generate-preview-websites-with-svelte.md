# Generate preview websites with Svelte

Preview websites will be generated as Svelte-based sites rather than React components or arbitrary raw HTML because the operator wants Svelte as the website generation target while keeping the broader workflow in TypeScript. This makes the generated website surface a deliberate boundary: the dashboard and worker can orchestrate the workflow, while the website builder agent outputs Svelte previews that can be rendered, reviewed, published, and later adapted into client work.
