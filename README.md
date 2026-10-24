# Innvil

### Infrastructure for launching, operating, and automating digital service businesses.

Innvil is an evolving software ecosystem built around one idea:

**Take operational work that is repetitive, fragmented, or unnecessarily manual, and turn it into systems that can increasingly run themselves.**

The project began as a **no-code white-label SMM platform**, designed to remove the technical and operational barriers involved in launching and managing a digital-service business.

That foundation later expanded into **Innvil Watch**, an AI-powered Telegram community operations platform and the current highlight of the Innvil ecosystem.

Today, Innvil combines SaaS infrastructure, automation, external APIs, payments, customer operations, AI-assisted workflows, and autonomous community tooling within one growing platform.

---

# Featured Project: Innvil Watch

## AI Virtual Moderators for Telegram

**Watchers are AI-powered Virtual Moderators that participate in conversations, moderate with context, answer from project-specific knowledge, and help operate Telegram communities even when the human team is away.**

Innvil Watch grew from a question that became increasingly interesting as the larger Innvil platform evolved:

> **Could an AI moderator stay continuously present in a Telegram community without behaving like a traditional bot?**

Traditional moderation bots are excellent at deterministic tasks.

They react to commands, keywords, predefined rules, and fixed workflows.

Watchers are designed for a different layer of community operations.

They can follow conversations, understand intent, determine whether their participation is useful, enforce community rules, answer project-specific questions, maintain distinct identities, and coordinate with other Watchers operating in the same community.

---

## What Is a Watcher?

A **Watcher** is an AI-powered Virtual Moderator deployed into a Telegram group, supergroup, or channel.

Each Watcher can have its own:

- Name
- Identity
- Persona
- Tone
- Communication style
- Community role
- Project Knowledge
- Moderation behavior
- Posting behavior
- Specialist responsibilities

A Watcher is not intended to sit silently until someone enters a command.

Once deployed, it becomes an active presence inside the community.

It can respond when useful, participate in conversation, step into moderation situations, help members, or remain silent when its contribution is unnecessary.

Sometimes the correct moderator response is no response at all.

---

## More Than a Traditional Moderation Bot

Innvil Watch is designed around **context rather than triggers alone**.

### Conversation

Watchers can interact naturally with members instead of relying exclusively on canned replies.

They can respond to greetings, answer questions, follow ongoing discussions, and communicate using their configured persona.

### Context

A Watcher can consider surrounding messages rather than treating every message as an isolated event.

### Moderation Judgment

Different violations do not always deserve identical responses.

A lower-level offense may warrant a warning.

Repeated behavior may escalate.

High-confidence phishing, scam links, or dangerous content may require immediate intervention.

### Continuous Presence

A Watcher can provide community and moderation coverage even when the human team is offline.

---

# Project Knowledge

One of the central systems behind Innvil Watch is **Project Knowledge**.

A Project acts as the knowledge container used by the Watchers associated with it.

This allows a Watcher to understand how a member is asking a question without inventing project-specific facts.

For example, a Watcher may understand shorthand such as:

```text
ca?
wen distro?
socials?
mc?
```

as well as common Telegram and Web3 terminology.

But understanding the question does not give the Watcher permission to fabricate the answer.

Project-specific responses remain grounded in the knowledge configured for that Project.

Knowledge is also isolated between Projects so information belonging to one project does not automatically carry into another.

---

# Watcher Personas

Watchers do not need to share one generic AI personality.

Each Watcher can have a different communication identity.

That can include differences in:

- Formality
- Humor
- Vocabulary
- Response length
- Tone
- Style
- Community responsibility

One Watcher may be calm and professional.

Another may be conversational and energetic.

Another may focus almost exclusively on moderation or member support.

The persona controls how the Watcher communicates while project knowledge and operational rules remain grounded in the configured system.

---

# Specialist Watchers

Multiple Watchers can be created with different responsibilities.

Examples include:

### Host

Participates in conversation, welcomes members, and helps maintain community activity.

### Knowledge

Focuses on project-specific questions using Project Knowledge.

### Spam & Scam

Focuses on promotional spam, suspicious links, phishing behavior, and related threats.

### Media Safety

Assists with unsafe image and video moderation.

### Rules & Conduct

Focuses on community rules and behavioral issues.

This allows community operations to be divided between specialized virtual moderators instead of expecting one bot to handle every situation identically.

---

# Multi-Watcher Coordination

Deploying several AI agents into one community creates a new problem:

**They should not all answer the same message.**

Innvil Watch includes coordination logic intended to make multiple Watchers behave more like a team.

A Watcher can consider whether another Watcher has already responded and whether its own response would add anything useful.

The goal is coordinated virtual moderation rather than a room full of automated accounts talking over one another.

---

# Context-Aware Moderation

Innvil Watch includes moderation workflows covering areas such as:

- Spam
- Unsolicited promotion
- Scam links
- Phishing
- Unsafe media
- Community-rule violations
- Repeated offenses

Moderation can use graduated enforcement.

Warnings can also be generated using the Watcher's configured persona rather than repeatedly sending the same mechanical template.

---

# Moderation Records

Automated moderation should still be observable.

Watcher operations can maintain structured records around actions such as:

- Warnings
- Mutes
- Kicks
- Purges
- Moderation reasons
- Action results

This gives community operators visibility into what their Watchers are actually doing.

---

# Member Support

Watchers are not limited to enforcement.

They can also:

- Answer project questions
- Explain known information
- Respond to common requests
- Participate in conversation
- Direct members toward useful resources
- Escalate situations requiring a human

This creates a layer between static FAQ bots and full-time human community support.

---

# Human Escalation

Automation should recognize its limits.

When a situation requires human judgment, a Watcher can escalate rather than inventing an answer or forcing an inappropriate automated response.

The goal is to automate what can reasonably be automated while preserving the point where a person should take over.

---

# Auto-Posting

Watchers can also support scheduled community activity.

Individual Watchers can be configured with posting windows so they can contribute to community activity outside normal team hours.

This functionality is configurable rather than automatically enabled.

---

# Watcher Deployment

Creating a Watcher and deploying a Watcher are separate operations.

A simplified setup flow looks like:

```text
Create Innvil account
        ↓
Create a Project
        ↓
Connect Telegram community
        ↓
Create Watcher
        ↓
Configure persona and behavior
        ↓
Deploy Watcher
        ↓
Monitor activity and moderation
```

---

# Who Innvil Watch Is For

Innvil Watch is particularly suited for:

### Crypto & Web3 Communities

Communities dealing with continuous conversation, repetitive project questions, spam, scams, and support.

### Growing Telegram Communities

Teams that need broader moderation coverage without requiring a human administrator online every hour.

### Projects With Active Member Support

Communities where members repeatedly ask project-specific questions.

### Teams Managing Multiple Communities

Organizations that want distinct virtual moderators with different roles or personalities across several Telegram groups.

---

# Works Alongside Existing Bots

Innvil Watch is not intended to replace every Telegram automation tool.

Traditional bots remain excellent for:

- Entry verification
- Commands
- Gatekeeping
- Utilities
- Deterministic rule enforcement

Watchers are designed for the more contextual side of community operations:

- Conversation
- Context
- Community presence
- Member support
- Context-aware moderation
- Project-specific knowledge

The two approaches can work together.

---

# Innvil Watch Development

Watch developed from experiments around whether AI could take on a more meaningful operational role inside online communities.

Development has included work around:

- Virtual moderator personas
- Natural conversation
- Community-specific knowledge
- Rule enforcement
- Warning behavior
- Spam and scam detection
- Conversation awareness
- Media moderation
- Multi-agent coordination
- Human escalation
- Scheduled community activity

It has since developed into its own product within the Innvil ecosystem.

---

# The Original Innvil Platform

Before Innvil Watch, Innvil began as infrastructure for launching and operating **white-label SMM panels**.

The goal was to remove much of the technical setup and repetitive operational work normally required to run one.

Users can create a branded panel, connect an external provider, import services, configure pricing, accept customers, manage balances, process orders, receive payments, and operate the business through one platform.

Innvil does not sell the underlying services itself.

Panel owners bring their own providers.

---

# What Innvil Does Today

## Create a Panel in Minutes

A panel can include its own:

- Name
- Subdomain
- Theme
- Storefront
- Customer dashboard
- Customer wallet
- Service catalog
- Pricing
- Support system
- Operational settings

Panels can be branded and managed independently.

---

## Bring Your Own Provider

Innvil supports provider integrations based around common SMM API patterns.

A connected provider can supply the catalog and fulfillment infrastructure while Innvil handles the surrounding application layer.

Capabilities include:

- Provider connection
- Catalog import
- Automatic categorization
- Provider/service mapping
- Pricing and markup
- Service synchronization
- Provider balance visibility
- Order forwarding
- Status reconciliation

Sensitive provider credentials remain server-side.

Innvil never exposes provider keys to the customer-facing application.

---

# Catalog Automation

Provider catalogs can contain hundreds or thousands of services.

Innvil automates much of the work required to turn that raw provider catalog into a usable storefront.

Current functionality includes:

- Full catalog import
- Automatic platform categorization
- Service-type organization
- Bulk selection
- Markup configuration
- Service editing
- Enable/disable controls
- Provider-price synchronization
- Min/max synchronization

The objective is to manage the catalog as structured application data rather than as a giant spreadsheet.

---

# Automated Order Pipeline

When a customer places an eligible order, Innvil can handle much of the lifecycle automatically.

The workflow includes:

```text
Customer order
      ↓
Validate service and balance
      ↓
Charge customer wallet
      ↓
Forward to connected provider
      ↓
Track provider order
      ↓
Synchronize status
      ↓
Reconcile completion / partial / cancellation
```

Current functionality includes:

- Order creation
- Provider routing
- Provider submission
- Automatic status synchronization
- Partial-order handling
- Refund workflows
- Duplicate-order protection
- Held-order handling
- Order history

The objective is to minimize manual intervention after the order is placed.

---

# Customer API

Innvil also exposes customer-facing API functionality for automated users.

Supported areas include:

- Service retrieval
- Single-order creation
- Batch order intake
- Order status
- Bulk status
- Balance queries
- Cancellation-related actions
- Refill-related actions

Batch workflows can process multiple orders in a single request while returning individual results for each submitted item.

---

# Wallet & Balance System

Every panel can maintain customer wallet balances.

Balance activity is tracked through transaction-oriented workflows rather than relying only on a single mutable number.

Activity can include:

- Deposits
- Order charges
- Refunds
- Manual credits
- Manual debits
- Promotional credit

This provides a clearer history of how a customer balance changes.

---

# Payments

Innvil uses a modular payment architecture so panel owners can connect supported payment providers.

Development has included integrations across traditional and crypto payment workflows.

Deposits can be reconciled back into customer wallets after confirmation without requiring manual approval for every transaction.

Specific provider availability may change as integrations continue to develop.

---

# Customer Management

Panel owners can manage customers through the owner interface.

Current operational tooling includes:

- Customer lists
- Account status
- Wallet balances
- Order activity
- Manual credits and debits
- Support activity
- Operational controls

Innvil also maintains a deliberate authentication boundary between panel owners and customers.

Panel owners manage customer accounts without requiring access to customer passwords.

---

# Support

Customers can open support requests from the panel storefront.

Panel operators can respond through their administration interface, keeping support communication associated with the relevant customer and panel.

---

# Panel Status Management

Panels can move through different operational states such as:

- Draft
- Live
- Inactive
- Suspended
- Maintenance

This allows owners to control whether a panel is being configured, actively serving customers, or temporarily unavailable.

---

# White-Label Branding

Each panel can operate as its own customer-facing brand.

Current branding functionality includes areas such as:

- Panel identity
- Themes
- Platform graphics
- Included subdomains
- Custom domains
- Storefront customization

The broader design system continues to expand.

---

# Design Shop

Innvil also includes a storefront-design layer intended to help panel owners avoid using identical generic storefronts.

The Design Shop provides alternate storefront designs while preserving the same underlying panel infrastructure.

---

# AI-Assisted Panel Operations

AI has also started to become part of the original Innvil platform.

Current development includes AI-assisted functionality around areas such as:

- Operator guidance
- Panel configuration
- Service workflows
- Customer support
- Catalog-aware responses

This brings the AI work developed through the wider project back into the original Innvil platform.

---

# One Innvil Ecosystem

Innvil and Innvil Watch solve different operational problems, but they share the same philosophy.

### Innvil Platform

Automates the infrastructure and operational work involved in running white-label digital-service businesses.

### Innvil Watch

Applies AI agents to Telegram community operations, moderation, member support, and continuous community presence.

Both are built around the same question:

> **What repetitive operational work can software take over without making the experience worse?**

---

# Vision

Innvil is intended to grow beyond a single product category.

The original platform started with SMM because the market contains many of the operational patterns Innvil is designed to solve:

- External providers
- APIs
- Digital services
- Customer wallets
- Payments
- Order fulfillment
- Subscriptions
- Customer support
- Automation
- Multi-tenant storefronts

The longer-term architectural goal is a modular operating layer capable of supporting other digital-service businesses built around similar patterns.

---

# Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js 16, App Router, Turbopack |
| UI | React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS + design tokens |
| Backend / Database | Supabase |
| Database | PostgreSQL |
| Authentication | Supabase Auth |
| Database Security | Row Level Security |
| Hosting | Vercel |
| Icons | lucide-react |
| Charts | Recharts |
| AI Development | ChatGPT, Codex, Claude, GitHub Copilot |

---

# High-Level Architecture

Innvil combines several layers of application infrastructure:

```text
Customer / Operator Interfaces
            ↓
       Next.js Application
            ↓
     Server-Side Workflows
        ↙           ↘
   Supabase       External APIs
      ↓            Providers
 PostgreSQL        Payments
 Authentication    Telegram
      ↓             AI
 Multi-Tenant Data
```

The public repository exposes the parts necessary to understand the application architecture while intentionally excluding private operational configuration.

---

# Project Structure

A simplified view of the repository:

```text
app/
  Application routes and API endpoints

src/
  components/
    Shared application and storefront UI

  lib/
    actions/
      Server-side application actions

    providers/
      Provider integration logic

    payments/
      Payment integration layer

    orders/
      Order processing and synchronization

    moderator/
      Innvil Watch community behavior

    products/
      Product-specific runtime logic

    supabase/
      Database and authentication clients

  data/
    Shared application data

  types/
    Shared TypeScript types

supabase/
  migrations/
    Database schema and access-control migrations

public/
  Public application assets
```

Internal project notes and sensitive configuration are intentionally excluded.

---

# Security Approach

Innvil handles several areas where security boundaries matter.

The project uses concepts including:

- Server-side credential handling
- Encrypted sensitive credentials
- Role-based access
- Row Level Security
- Multi-tenant data isolation
- Protected backend operations
- Transaction-backed balance workflows
- Server-side external API calls
- Separate customer and operator permissions

Production credentials and private operational configuration are never intended to be committed to the repository.

---

# Getting Started

For local development:

```bash
npm install
npm run dev
```

The development application will normally be available at:

```text
http://localhost:3000
```

Create a local environment file based on the project's environment template and configure the required Supabase and application credentials.

Database migrations are located under:

```text
supabase/migrations/
```

Apply them in migration order to the development Supabase project.

Production credentials should never be committed to source control.

---

# Built Through AI-Assisted Development

Innvil is also a practical experiment in **AI-assisted software development**.

AI is used throughout the development lifecycle rather than simply to generate isolated snippets of code.

---

## ChatGPT

ChatGPT is primarily used as the reasoning, planning, debugging, and technical-learning layer.

I use it to:

- Understand technical concepts
- Break down feature requirements
- Explore architecture
- Think through application behavior
- Develop implementation instructions
- Analyze existing code
- Understand why implementations work
- Investigate why they fail
- Compare potential fixes
- Learn while actively developing

The objective is not simply to receive generated code.

It is to understand the system well enough to guide the next implementation decision.

---

## Codex

Codex is currently my primary AI coding tool.

I use it for:

- Implementing features
- Modifying existing systems
- Working across the existing codebase
- Debugging
- Refactoring
- Testing
- Investigating implementations
- Fixing issues
- Iterating on functionality

Development is iterative.

A feature is implemented, tested, observed, corrected, and tested again.

---

## Claude

Claude played a significant role during earlier stages of Innvil development.

It was used for:

- Initial application development
- Feature implementation
- Application structure
- UI workflows
- Translating specifications into working functionality
- Refining existing features

Generated implementations were then tested, reviewed, and revised.

---

## GitHub Copilot

GitHub Copilot has also been used as an in-editor development assistant for:

- Code completion
- Repetitive implementation
- Suggestions
- Smaller development tasks
- Exploring possible fixes

---

# Development Workflow

A typical Innvil development cycle looks roughly like:

```text
Problem or idea
        ↓
Understand the requirement
        ↓
Research and reason through approaches
        ↓
Define expected behavior
        ↓
Implement with AI-assisted tools
        ↓
Run and test
        ↓
Observe unexpected behavior
        ↓
Understand why it happened
        ↓
Modify the implementation
        ↓
Test again
        ↓
Integrate into the existing system
```

The platform has grown through repeated development cycles rather than being generated as one large application.

---

# Development Principles

### Platform First

Prefer capabilities that strengthen the underlying platform and can be reused across products.

### Modular

New providers, integrations, payment systems, AI functionality, and future business verticals should integrate without requiring the core application to be rebuilt.

### Solve the Operational Problem

Features should exist because there is an identifiable workflow problem behind them.

### Automate Repetition

If a predictable task continually consumes operator time, it is a candidate for automation.

### Secure by Default

Sensitive credentials and privileged operations should remain server-side.

### Understand the Implementation

AI can accelerate development, but generated code still needs to be understood.

### Test What AI Builds

AI-assisted code still requires testing, debugging, review, and refinement.

### Improve Continuously

Working software can still become more reliable, maintainable, understandable, and useful.

---

# Current Status

Innvil is under active development.

## Innvil Watch

Current work includes substantial functionality around:

- Watcher creation
- Watcher deployment
- Telegram community integration
- Configurable personas
- Project Knowledge
- Natural community participation
- Context-aware moderation
- Spam and scam workflows
- Media-safety workflows
- Multi-Watcher coordination
- Moderation records
- Human escalation
- Auto-Posting
- Watcher activity and administration

## Innvil Platform

Current functionality and development include:

- Panel creation
- White-label storefronts
- Customer accounts
- Provider integrations
- Catalog automation
- Order automation
- Wallets
- Deposits
- Payment integrations
- Customer support
- Customer APIs
- Provider tracking
- Owner administration
- AI-assisted panel features

Additional testing, integrations, automation, analytics, reliability work, and product development continue.

---

# Roadmap

A public roadmap will be added as Innvil and Innvil Watch continue to develop.

The public roadmap will focus on major product direction and capabilities rather than private implementation details.

---

# Repository Notes

This repository is intentionally not a complete dump of every artifact used during development.

The public repository excludes material such as:

- Internal planning documents
- Private AI instructions
- Development scratch files
- Production credentials
- Environment secrets
- Sensitive operational configuration
- Private roadmaps
- Internal implementation notes

The purpose of the public repository is to show the project's architecture, development history, capabilities, and engineering work without exposing private operational material.

---

# Why I Built It

Innvil began with an interest in using AI and automation to solve operational problems rather than simply experiment with new technology.

The original platform focused on removing repetitive commerce, provider, customer, and administration work from running a digital-service business.

Innvil Watch pushed the idea further.

Instead of asking only:

> What tasks can software automate?

Watch asks:

> **How much useful operational responsibility can an AI agent take on while still behaving naturally, predictably, and under human control?**

That question continues to shape Innvil.

---

© 2026 Innvil