#!/usr/bin/env python3
import json
import sys

# Read the JSON file
try:
    with open('/Users/MAC/.claude/projects/-/248e3cb3-1d1c-4cd0-859d-5f164b1dcb65/tool-results/mcp-openvisio-team-list_tasks-1792183172403.txt', 'r') as f:
        data = json.load(f)
except Exception as e:
    print(f"Error reading file: {e}", file=sys.stderr)
    sys.exit(1)

# Extract tasks
tasks = data.get('items', []) if isinstance(data, dict) else data if isinstance(data, list) else []

print("=" * 80)
print("TASK ANALYSIS REPORT")
print("=" * 80)
print()

# Categories
scout_tasks = []
unassigned_tasks = []
waiting_review_tasks = []

# Process tasks
for task in tasks:
    agent_id = task.get('agent_id')
    status = task.get('status', '')
    
    # Scout-assigned (agent_id = 53)
    if agent_id == 53:
        scout_tasks.append(task)
    
    # Unassigned (agent_id = null)
    if agent_id is None:
        unassigned_tasks.append(task)
    
    # Waiting in Review status
    if 'Waiting in Review' in status or status == 'Waiting in Review':
        waiting_review_tasks.append(task)

# Report counts
print(f"TOTAL TASKS: {len(tasks)}")
print(f"Scout-assigned tasks (agent_id=53): {len(scout_tasks)}")
print(f"Unassigned tasks (agent_id=null): {len(unassigned_tasks)}")
print(f"Waiting in Review tasks: {len(waiting_review_tasks)}")
print()

# Scout-assigned tasks - show ALL
if scout_tasks:
    print("=" * 80)
    print("SCOUT-ASSIGNED TASKS (agent_id = 53) - FULL DETAILS")
    print("=" * 80)
    for i, task in enumerate(scout_tasks, 1):
        print(f"\n[Task {i}]")
        print(f"  ID: {task.get('id', 'N/A')}")
        print(f"  Title: {task.get('title', 'N/A')}")
        print(f"  Status: {task.get('status', 'N/A')}")
        print(f"  Agent ID: {task.get('agent_id', 'N/A')}")
        print(f"  Assigned To: {task.get('assigned_to', 'N/A')}")
else:
    print("No Scout-assigned tasks found")

print()

# Unassigned tasks - show first 50
if unassigned_tasks:
    print("=" * 80)
    print(f"UNASSIGNED TASKS (agent_id = null) - FIRST {min(50, len(unassigned_tasks))} of {len(unassigned_tasks)}")
    print("=" * 80)
    for i, task in enumerate(unassigned_tasks[:50], 1):
        print(f"{i:3d}. [ID: {task.get('id', 'N/A')[:12]}...] {task.get('title', 'N/A')[:60]:<60} | Status: {task.get('status', 'N/A')}")
else:
    print("No unassigned tasks found")

print()

# Waiting in Review tasks
if waiting_review_tasks:
    print("=" * 80)
    print(f"WAITING IN REVIEW TASKS - ALL {len(waiting_review_tasks)}")
    print("=" * 80)
    for i, task in enumerate(waiting_review_tasks, 1):
        print(f"\n[Task {i}]")
        print(f"  ID: {task.get('id', 'N/A')}")
        print(f"  Title: {task.get('title', 'N/A')}")
        print(f"  Status: {task.get('status', 'N/A')}")
        print(f"  Agent ID: {task.get('agent_id', 'N/A')}")
        print(f"  Assigned To: {task.get('assigned_to', 'N/A')}")
else:
    print("No Waiting in Review tasks found")

print()
print("=" * 80)