#!/bin/bash
# Janeway Dictate Starter - aktiviert venv und startet die App
cd "$(dirname "$0")"
exec .venv/bin/python3 janeway-dictate.py "$@"
