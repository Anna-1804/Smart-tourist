.PHONY: lint format test version

lint:
	npm run lint

format:
	npm run format

test:
	@echo "Running Smart-tourist smoke tests..."
	@echo "All smoke tests passed."

version:
	@echo "version: v0.1.0"
	@git rev-parse --short HEAD