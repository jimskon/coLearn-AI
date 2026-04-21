# coLearn-AI Architecture and Design

## Overview

coLearn-AI is a structured learning system designed to enforce reasoning, collaboration, and process visibility in the presence of AI tools.

---

## Design Principles

### Prevent Cognitive Bypass
Students must engage in reasoning before progressing.

### Enforce Collaboration
One active student at a time, rotating participation.

### Preserve Epistemic Trace
All responses are stored in an append-only model.

---

## System Architecture

Browser → nginx → Node/Express → MariaDB  
                 ↘ Socket.IO  
                 ↘ C++ Runner (Docker)

---

## Components

### Frontend
- React (Vite)
- Static hosting via nginx

### Backend
- Node / Express
- Handles auth, activities, AI evaluation

### Database
- MariaDB
- Append-only responses

### C++ Runner
- Docker service
- Exposed via /cxx-run

---

## Data Model

Responses are append-only.

Current state is derived using:

MAX(id) per question

---

## AI Role

AI provides:
- feedback
- follow-up prompts

AI does NOT provide answers.

---

## Deployment Model

- nginx → frontend + proxy
- PM2 → backend
- MariaDB → data
- Docker → execution services

---

## Purpose

coLearn-AI measures:

- reasoning
- iteration
- collaboration

not just correctness.
