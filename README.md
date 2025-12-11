# AI Page Assistant (Firefox extension)

This WebExtension lets you ask an AI model about selected text or an entire page. It supports any OpenAI- or Anthropic-compatible API endpoint so you can point it at hosted services or self-hosted gateways.

## Features
- Right-click selected text to ask for an explanation and actionable insight.
- Right-click a page to request a summary and top takeaways.
- Configure provider (OpenAI-style or Anthropic), base URL, model, temperature, and max tokens in the toolbar popup.
- Responses open in a dedicated tab and persist until you overwrite them.

## Setup
1. Clone this repository.
2. In Firefox, open `about:debugging#/runtime/this-firefox`.
3. Choose **Load Temporary Add-on** and select the `manifest.json` file in this folder.
4. Click the toolbar icon to enter your API key and endpoint settings.

## Notes on API compatibility
- **OpenAI-compatible:** Uses the `chat/completions` schema with `Authorization: Bearer <apiKey>` and a simple system prompt.
- **Anthropic:** Calls the `v1/messages` endpoint with `x-api-key` and `anthropic-version: 2023-06-01` headers.
- You can override the base URL for self-hosted or proxy deployments.

## Development
The extension is plain HTML/CSS/JS; no build step is required. After editing, reload the temporary add-on in Firefox to pick up changes.
