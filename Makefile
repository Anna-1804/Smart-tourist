.PHONY: lint format test e2e mutation version

lint:
	npm run lint

format:
	npm run format

test:
	npm test

e2e:
	npm run test:e2e

mutation:
	npm run test:mutation

version:
	@echo "version: v0.1.0"
	@git rev-parse --short HEAD