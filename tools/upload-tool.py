#!/usr/bin/env python3
"""
Upload a tool to Letta API and optionally attach it to an agent.

Usage:
    python upload-tool.py <tool_name> [--attach-to-agent AGENT_ID]
    
Example:
    python upload-tool.py send_discord_message
    python upload-tool.py send_discord_message --attach-to-agent agent-abc123
    
The script expects:
- A Python file: tools/<tool_name>.py
- A JSON schema: tools/<tool_name>.json
- Environment variables: LETTA_API_KEY, optionally LETTA_AGENT_ID
"""

import os
import sys
import json
import requests
from pathlib import Path

def load_tool_files(tool_name):
    """Load Python source and JSON schema for a tool."""
    base_path = Path(__file__).parent
    
    py_file = base_path / f"{tool_name}.py"
    json_file = base_path / f"{tool_name}.json"
    
    if not py_file.exists():
        raise FileNotFoundError(f"Python file not found: {py_file}")
    if not json_file.exists():
        raise FileNotFoundError(f"JSON schema not found: {json_file}")
    
    with open(py_file, 'r') as f:
        source_code = f.read()
    
    with open(json_file, 'r') as f:
        json_schema = json.load(f)
    
    return source_code, json_schema

def upload_tool(api_key, tool_name, source_code, json_schema, tags=None):
    """Upload a tool to the Letta API."""
    
    payload = {
        "source_type": "python",
        "source_code": source_code,
        "json_schema": json_schema,
        "tags": tags or []
    }
    
    # Add description from json_schema if not in payload
    if "description" in json_schema:
        payload["description"] = json_schema["description"]
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    response = requests.post(
        "https://api.letta.com/v1/tools",
        json=payload,
        headers=headers
    )
    
    if response.status_code in (200, 201):
        tool_data = response.json()
        print(f"✅ Tool '{tool_name}' uploaded successfully!")
        print(f"   ID: {tool_data['id']}")
        return tool_data['id']
    else:
        print(f"❌ Upload failed: {response.status_code}")
        print(f"   {response.text}")
        return None

def attach_tool_to_agent(api_key, agent_id, tool_id):
    """Attach a tool to an agent."""
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    # Get current tools
    response = requests.get(
        f"https://api.letta.com/v1/agents/{agent_id}",
        headers=headers
    )
    
    if response.status_code != 200:
        print(f"❌ Failed to get agent: {response.text}")
        return False
    
    agent_data = response.json()
    current_tool_ids = [t['id'] for t in agent_data.get('tools', [])]
    
    if tool_id in current_tool_ids:
        print(f"ℹ️  Tool already attached to agent")
        return True
    
    # Add new tool
    new_tool_ids = current_tool_ids + [tool_id]
    
    response = requests.patch(
        f"https://api.letta.com/v1/agents/{agent_id}",
        json={"tool_ids": new_tool_ids},
        headers=headers
    )
    
    if response.status_code == 200:
        print(f"✅ Tool attached to agent {agent_id}")
        return True
    else:
        print(f"❌ Failed to attach tool: {response.text}")
        return False

def main():
    if len(sys.argv) < 2:
        print("Usage: python upload-tool.py <tool_name> [--attach-to-agent AGENT_ID]")
        sys.exit(1)
    
    tool_name = sys.argv[1]
    
    # Check for attach flag
    attach_to_agent = None
    if "--attach-to-agent" in sys.argv:
        idx = sys.argv.index("--attach-to-agent")
        if idx + 1 < len(sys.argv):
            attach_to_agent = sys.argv[idx + 1]
    
    # Get API key
    api_key = os.getenv("LETTA_API_KEY")
    if not api_key:
        print("❌ LETTA_API_KEY environment variable not set")
        sys.exit(1)
    
    # If no agent specified but LETTA_AGENT_ID is set, use that
    if not attach_to_agent:
        attach_to_agent = os.getenv("LETTA_AGENT_ID")
    
    try:
        # Load tool files
        print(f"📂 Loading tool files for '{tool_name}'...")
        source_code, json_schema = load_tool_files(tool_name)
        
        # Upload tool
        print(f"⬆️  Uploading to Letta API...")
        tool_id = upload_tool(api_key, tool_name, source_code, json_schema, tags=["discord", "custom"])
        
        if not tool_id:
            sys.exit(1)
        
        # Attach to agent if requested
        if attach_to_agent:
            print(f"🔗 Attaching to agent {attach_to_agent}...")
            attach_tool_to_agent(api_key, attach_to_agent, tool_id)
        
        print("\n🎉 Done!")
        
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()

