# Example Node.js backend for securely fetching Tuya device data

This small Express service retrieves data from the Tuya OpenAPI (server-to-server) and exposes a simple endpoint the frontend can call without exposing your secrets.

Important: NEVER put your Tuya client secret in a public repo. Use environment variables when deploying.

Files:
- server.js        -> main Express app
- package.json     -> npm metadata
- .env.example     -> example environment variables
- README_TUYA.md   -> setup & deployment instructions

