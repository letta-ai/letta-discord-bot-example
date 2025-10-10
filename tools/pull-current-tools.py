#!/usr/bin/env python3
"""
PULL CURRENT TOOLS FROM LETTA AGENT
====================================

This script downloads ALL tools currently attached to your agent
and saves them as files in /tools directory.

Usage:
    python3 pull-current-tools.py

This creates:
    - /tools/<tool_name>.py (source code)
    - /tools/<tool_name>.json (JSON schema)
    - /tools/tools.config.json (config for attach/detach)
"""

import os
import sys
import json
import requests

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

LETTA_API_KEY = os.getenv("LETTA_API_KEY")
LETTA_BASE_URL = os.getenv("LETTA_BASE_URL", "https://api.letta.com")
LETTA_AGENT_ID = os.getenv("LETTA_AGENT_ID")
DISCORD_BOT_TOKEN = os.getenv("DISCORD_BOT_TOKEN", "")

TOOLS_DIR = os.path.join(os.path.dirname(__file__), "tools")

def get_agent_tools():
    """Fetch agent and its tools"""
    headers = {
        "Authorization": f"Bearer {LETTA_API_KEY}",
        "Content-Type": "application/json"
    }
    
    response = requests.get(
        f"{LETTA_BASE_URL}/v1/agents/{LETTA_AGENT_ID}",
        headers=headers,
        timeout=30
    )
    
    if response.status_code != 200:
        print(f"❌ Failed to fetch agent: {response.text}")
        return None
    
    return response.json()

def save_tool_files(tool, tools_dir):
    """Save tool as .py and .json files"""
    tool_name = tool["name"]
    
    # Save source code (.py)
    if tool.get("source_code"):
        source = tool["source_code"]
        
        # Replace actual token with placeholder
        if DISCORD_BOT_TOKEN and DISCORD_BOT_TOKEN in source:
            source = source.replace(DISCORD_BOT_TOKEN, "YOUR_DISCORD_BOT_TOKEN_HERE")
        
        py_path = os.path.join(tools_dir, f"{tool_name}.py")
        with open(py_path, "w") as f:
            f.write(source)
        print(f"   ✅ Saved: {tool_name}.py")
    else:
        print(f"   ⚠️  No source code for {tool_name} (built-in tool)")
    
    # Save JSON schema (.json)
    if tool.get("json_schema"):
        json_path = os.path.join(tools_dir, f"{tool_name}.json")
        with open(json_path, "w") as f:
            json.dump(tool["json_schema"], f, indent=2)
        print(f"   ✅ Saved: {tool_name}.json")

def create_config_file(tools, tools_dir):
    """Create tools.config.json for managing attach/detach"""
    config = {
        "_comment": "Edit 'attached' to true/false to manage which tools are on your agent",
        "tools": []
    }
    
    for tool in tools:
        tool_entry = {
            "name": tool["name"],
            "attached": True,  # Currently attached
            "type": tool.get("tool_type", "custom"),
            "description": tool.get("description", "")[:100] + "..." if tool.get("description") else "",
            "has_source": bool(tool.get("source_code"))
        }
        config["tools"].append(tool_entry)
    
    config_path = os.path.join(tools_dir, "tools.config.json")
    with open(config_path, "w") as f:
        json.dump(config, f, indent=2)
    
    print(f"\n✅ Created config: tools.config.json")
    print(f"   Edit this file to manage which tools to attach/detach")

def main():
    if not LETTA_API_KEY or not LETTA_AGENT_ID:
        print("❌ Missing LETTA_API_KEY or LETTA_AGENT_ID")
        return 1
    
    print("📥 Pulling current tools from Letta agent...")
    print(f"   Agent ID: {LETTA_AGENT_ID}")
    print()
    
    # Get agent data
    agent_data = get_agent_tools()
    if not agent_data:
        return 1
    
    # Ensure tools directory exists
    os.makedirs(TOOLS_DIR, exist_ok=True)
    
    # Get tools list
    tools = agent_data.get("tools", [])
    print(f"📊 Found {len(tools)} tools attached to agent\n")
    
    # Save each tool
    for i, tool_ref in enumerate(tools, 1):
        # tool_ref might be just a name string or a dict
        tool_name = tool_ref if isinstance(tool_ref, str) else tool_ref.get("name")
        
        print(f"{i}. Fetching {tool_name}...")
        
        # Get full tool details
        headers = {
            "Authorization": f"Bearer {LETTA_API_KEY}",
            "Content-Type": "application/json"
        }
        
        response = requests.get(
            f"{LETTA_BASE_URL}/v1/tools/{tool_name}",
            headers=headers,
            timeout=30
        )
        
        if response.status_code == 200:
            tool_data = response.json()
            save_tool_files(tool_data, TOOLS_DIR)
        else:
            print(f"   ⚠️  Could not fetch tool details: {response.text}")
    
    # Create config file
    print()
    all_tools = []
    for tool_ref in tools:
        tool_name = tool_ref if isinstance(tool_ref, str) else tool_ref.get("name")
        headers = {
            "Authorization": f"Bearer {LETTA_API_KEY}",
            "Content-Type": "application/json"
        }
        response = requests.get(
            f"{LETTA_BASE_URL}/v1/tools/{tool_name}",
            headers=headers,
            timeout=30
        )
        if response.status_code == 200:
            all_tools.append(response.json())
    
    create_config_file(all_tools, TOOLS_DIR)
    
    print()
    print("=" * 60)
    print("✅ Pull complete!")
    print()
    print(f"📂 Tools saved to: {TOOLS_DIR}")
    print()
    print("📝 Next steps:")
    print("   1. Edit tools.config.json to manage attach/detach")
    print("   2. Run: python3 sync-tools-to-agent.py")
    print()
    
    return 0

if __name__ == "__main__":
    sys.exit(main())

