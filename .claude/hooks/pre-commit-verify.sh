#!/bin/bash
# Pre-commit verification hook
# Runs npm run verify before git commit commands
set -e

cd "$CLAUDE_PROJECT_DIR"

# Read the hook input from stdin
INPUT=$(cat)

# Extract the command being run
COMMAND=$(echo "$INPUT" | node -e "
const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
console.log(input.tool_input?.command || '');
")

# Check if this is a git commit command
if echo "$COMMAND" | grep -qE 'git\s+commit'; then
  echo "Running pre-commit verification..." >&2

  # Run verification
  if npm run verify --quiet 2>&1; then
    # Verification passed
    echo '{"result": "continue", "message": "Pre-commit verification passed"}'
  else
    # Verification failed - block the commit
    echo '{"result": "block", "message": "Pre-commit verification FAILED. Run `npm run verify` to see details. Fix issues before committing."}'
    exit 0
  fi
else
  # Not a git commit, allow to proceed
  echo '{"result": "continue"}'
fi
