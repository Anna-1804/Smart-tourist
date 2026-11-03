.PHONY: lint format test version

lint:
	npm run lint

format:
	npm run format

test:
	npm test

version:
	@echo "version: v0.1.0"
	@git rev-parse --short HEAD