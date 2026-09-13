--
-- PostgreSQL database dump
--

\restrict L6ILpYy4d4gkXoey3bV2hbKHIk88aFD7Kks1GynxNMr6K57HLwh0HXo9fc31uDc

-- Dumped from database version 17.9 (Debian 17.9-1.pgdg13+1)
-- Dumped by pg_dump version 17.9 (Debian 17.9-1.pgdg13+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: execution; Type: SCHEMA; Schema: -; Owner: aa_execution
--

CREATE SCHEMA execution;


ALTER SCHEMA execution OWNER TO aa_execution;

--
-- Name: integrations; Type: SCHEMA; Schema: -; Owner: aa_integrations
--

CREATE SCHEMA integrations;


ALTER SCHEMA integrations OWNER TO aa_integrations;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: dispatches; Type: TABLE; Schema: execution; Owner: aa_execution
--

CREATE TABLE execution.dispatches (
    run_id text NOT NULL,
    effect text NOT NULL,
    digest text NOT NULL,
    workflow_sha text NOT NULL
);


ALTER TABLE execution.dispatches OWNER TO aa_execution;

--
-- Name: effects; Type: TABLE; Schema: execution; Owner: aa_execution
--

CREATE TABLE execution.effects (
    id text NOT NULL,
    env text NOT NULL,
    manifest jsonb NOT NULL,
    digest text NOT NULL,
    expected_prior text NOT NULL,
    kind text NOT NULL,
    parent text,
    expires_at timestamp with time zone NOT NULL,
    rollback_until timestamp with time zone NOT NULL,
    revoked boolean DEFAULT false NOT NULL,
    canceled boolean DEFAULT false NOT NULL,
    allow_rollback boolean DEFAULT true NOT NULL,
    state text DEFAULT 'approved'::text NOT NULL,
    claim_run text,
    claim_attempt integer,
    consumed_at timestamp with time zone,
    receipt jsonb
);


ALTER TABLE execution.effects OWNER TO aa_execution;

--
-- Name: environments; Type: TABLE; Schema: execution; Owner: aa_execution
--

CREATE TABLE execution.environments (
    id text NOT NULL,
    owner text,
    current_release text NOT NULL,
    generation integer DEFAULT 0 NOT NULL,
    hold boolean DEFAULT false NOT NULL
);


ALTER TABLE execution.environments OWNER TO aa_execution;

--
-- Name: inbox; Type: TABLE; Schema: execution; Owner: aa_execution
--

CREATE TABLE execution.inbox (
    id text NOT NULL,
    digest text NOT NULL,
    payload jsonb NOT NULL,
    verdict text NOT NULL
);


ALTER TABLE execution.inbox OWNER TO aa_execution;

--
-- Name: journal; Type: TABLE; Schema: execution; Owner: aa_execution
--

CREATE TABLE execution.journal (
    id bigint NOT NULL,
    command jsonb NOT NULL,
    result jsonb NOT NULL
);


ALTER TABLE execution.journal OWNER TO aa_execution;

--
-- Name: journal_id_seq; Type: SEQUENCE; Schema: execution; Owner: aa_execution
--

CREATE SEQUENCE execution.journal_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE execution.journal_id_seq OWNER TO aa_execution;

--
-- Name: journal_id_seq; Type: SEQUENCE OWNED BY; Schema: execution; Owner: aa_execution
--

ALTER SEQUENCE execution.journal_id_seq OWNED BY execution.journal.id;


--
-- Name: outbox; Type: TABLE; Schema: execution; Owner: aa_execution
--

CREATE TABLE execution.outbox (
    id text NOT NULL,
    payload jsonb NOT NULL,
    delivered boolean DEFAULT false NOT NULL
);


ALTER TABLE execution.outbox OWNER TO aa_execution;

--
-- Name: intents; Type: TABLE; Schema: integrations; Owner: aa_integrations
--

CREATE TABLE integrations.intents (
    id text NOT NULL,
    digest text NOT NULL,
    state text NOT NULL,
    manifest jsonb,
    detail jsonb DEFAULT '{}'::jsonb NOT NULL
);


ALTER TABLE integrations.intents OWNER TO aa_integrations;

--
-- Name: journal; Type: TABLE; Schema: integrations; Owner: aa_integrations
--

CREATE TABLE integrations.journal (
    id bigint NOT NULL,
    command jsonb NOT NULL,
    result jsonb NOT NULL
);


ALTER TABLE integrations.journal OWNER TO aa_integrations;

--
-- Name: journal_id_seq; Type: SEQUENCE; Schema: integrations; Owner: aa_integrations
--

CREATE SEQUENCE integrations.journal_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE integrations.journal_id_seq OWNER TO aa_integrations;

--
-- Name: journal_id_seq; Type: SEQUENCE OWNED BY; Schema: integrations; Owner: aa_integrations
--

ALTER SEQUENCE integrations.journal_id_seq OWNED BY integrations.journal.id;


--
-- Name: outbox; Type: TABLE; Schema: integrations; Owner: aa_integrations
--

CREATE TABLE integrations.outbox (
    id text NOT NULL,
    payload jsonb NOT NULL,
    delivered boolean DEFAULT false NOT NULL
);


ALTER TABLE integrations.outbox OWNER TO aa_integrations;

--
-- Name: receipts; Type: TABLE; Schema: integrations; Owner: aa_integrations
--

CREATE TABLE integrations.receipts (
    id text NOT NULL,
    payload jsonb NOT NULL
);


ALTER TABLE integrations.receipts OWNER TO aa_integrations;

--
-- Name: journal id; Type: DEFAULT; Schema: execution; Owner: aa_execution
--

ALTER TABLE ONLY execution.journal ALTER COLUMN id SET DEFAULT nextval('execution.journal_id_seq'::regclass);


--
-- Name: journal id; Type: DEFAULT; Schema: integrations; Owner: aa_integrations
--

ALTER TABLE ONLY integrations.journal ALTER COLUMN id SET DEFAULT nextval('integrations.journal_id_seq'::regclass);


--
-- Data for Name: dispatches; Type: TABLE DATA; Schema: execution; Owner: aa_execution
--

COPY execution.dispatches (run_id, effect, digest, workflow_sha) FROM stdin;
34771958467	revoked	a5cdfa1a68b002f55c97bf4600f5e00ff408032f63770b87cb14828b6573c0d8	3d2359e61d986f0db8ca7218fc8e3251a41a6103
34771959663	expired	a5cdfa1a68b002f55c97bf4600f5e00ff408032f63770b87cb14828b6573c0d8	3d2359e61d986f0db8ca7218fc8e3251a41a6103
34771961118	wrong-workflow	b19427ac4cbb8677f18a5a4579f06e6e73c23f75bed2e496fcfa88420de148d3	3d2359e61d986f0db8ca7218fc8e3251a41a6103
34771962538	staging-release	755e63b8716b44a0472af6cf7ffc939c2de32bdc21a73405a378b3aa6dc19a4d	3d2359e61d986f0db8ca7218fc8e3251a41a6103
34771963758	staging-release	755e63b8716b44a0472af6cf7ffc939c2de32bdc21a73405a378b3aa6dc19a4d	3d2359e61d986f0db8ca7218fc8e3251a41a6103
\.


--
-- Data for Name: effects; Type: TABLE DATA; Schema: execution; Owner: aa_execution
--

COPY execution.effects (id, env, manifest, digest, expected_prior, kind, parent, expires_at, rollback_until, revoked, canceled, allow_rollback, state, claim_run, claim_attempt, consumed_at, receipt) FROM stdin;
prod-release	prod	{"fault": "execute", "stack": "arn:aws:cloudformation:eu-west-1:728616601473:stack/aa-wf15l-prod/9c8265f0-af97-11f1-bd12-0ab828536263", "bucket": "aa-wf15l-728616601473-eu-west-1-artifacts", "region": "eu-west-1", "account": "728616601473", "artifact": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "function": "aa-wf15l-prod", "candidate": "healthy", "health_url": "https://jkxzl96f6l.execute-api.eu-west-1.amazonaws.com/health", "environment": "prod", "artifact_key": "releases/5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e/function.zip", "configuration": {"PROBE_ENVIRONMENT": "prod"}, "health_policy": "one-bounded-health-sample-v1", "expected_prior": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "staging_effect": "staging-release", "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "rollback_policy": "restore-retained-on-failed-health-v1", "rollback_target": {"artifact": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "candidate": "baseline", "artifact_key": "releases/e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17/function.zip", "configuration": {"PROBE_ENVIRONMENT": "prod"}, "artifact_source": "23f34a34d07529f09ec1ced68003e98c694c1bce", "template_sha256": "266077f52a321c716a596793c09952cb16e1d629fb48aad09f1d2891fd4f9b77", "artifact_version": "n50J6uoiBZXtkGaXzJMxzNuZ3w5Zhgis"}, "template_sha256": "fe1b9f134056db40168f0d2ca06496001cfc72addaaaa5a405fdfb6eeef242f3", "artifact_version": "1bKgxlvkbp5uDwndsKINrxNr360IyVeI", "workflow_revision": "3d2359e61d986f0db8ca7218fc8e3251a41a6103", "controller_revision": "f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8", "environment_generation": 0}	85085cb15f6e355c65eb771d9e0f181643672bedfdede401f48758baef135c58	e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17	deploy	\N	2026-09-13 20:33:02.065357+00	2026-09-13 20:33:02.065358+00	f	f	t	approved	\N	\N	\N	\N
staging-failure	staging	{"fault": "none", "stack": "arn:aws:cloudformation:eu-west-1:728616601473:stack/aa-wf15l-staging/20936890-af97-11f1-879a-0afb2c52a213", "bucket": "aa-wf15l-728616601473-eu-west-1-artifacts", "region": "eu-west-1", "account": "728616601473", "artifact": "fb1f9e4237d6a8643223ed8cf29e65af80733268f61397bf03684f3ce0f899fb", "function": "aa-wf15l-staging", "candidate": "unhealthy", "health_url": "https://1h4l6ktvd1.execute-api.eu-west-1.amazonaws.com/health", "environment": "staging", "artifact_key": "releases/fb1f9e4237d6a8643223ed8cf29e65af80733268f61397bf03684f3ce0f899fb/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "health_policy": "one-bounded-health-sample-v1", "expected_prior": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "rollback_policy": "restore-retained-on-failed-health-v1", "rollback_target": {"artifact": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "candidate": "healthy", "artifact_key": "releases/5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "template_sha256": "fe1b9f134056db40168f0d2ca06496001cfc72addaaaa5a405fdfb6eeef242f3", "artifact_version": "1bKgxlvkbp5uDwndsKINrxNr360IyVeI"}, "template_sha256": "92b3507095c8bb00ac534c6d16021907633722e7602bda7a4aa9af97a7ceb8fb", "artifact_version": "T0zXWcyF3VpUwhTgzjxCRwoBrvSvb07b", "workflow_revision": "3d2359e61d986f0db8ca7218fc8e3251a41a6103", "controller_revision": "f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8", "environment_generation": 1}	46c195277286c6220b3f98d6afe54814be33421e1b5e8343d43ecfd0c4541dae	5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e	deploy	\N	2026-09-13 20:33:02.072127+00	2026-09-13 20:33:02.072128+00	f	f	t	approved	\N	\N	\N	\N
prod-failure	prod	{"fault": "none", "stack": "arn:aws:cloudformation:eu-west-1:728616601473:stack/aa-wf15l-prod/9c8265f0-af97-11f1-bd12-0ab828536263", "bucket": "aa-wf15l-728616601473-eu-west-1-artifacts", "region": "eu-west-1", "account": "728616601473", "artifact": "fb1f9e4237d6a8643223ed8cf29e65af80733268f61397bf03684f3ce0f899fb", "function": "aa-wf15l-prod", "candidate": "unhealthy", "health_url": "https://jkxzl96f6l.execute-api.eu-west-1.amazonaws.com/health", "environment": "prod", "artifact_key": "releases/fb1f9e4237d6a8643223ed8cf29e65af80733268f61397bf03684f3ce0f899fb/function.zip", "configuration": {"PROBE_ENVIRONMENT": "prod"}, "health_policy": "one-bounded-health-sample-v1", "expected_prior": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "rollback_policy": "restore-retained-on-failed-health-v1", "rollback_target": {"artifact": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "candidate": "healthy", "artifact_key": "releases/5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e/function.zip", "configuration": {"PROBE_ENVIRONMENT": "prod"}, "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "template_sha256": "fe1b9f134056db40168f0d2ca06496001cfc72addaaaa5a405fdfb6eeef242f3", "artifact_version": "1bKgxlvkbp5uDwndsKINrxNr360IyVeI"}, "template_sha256": "92b3507095c8bb00ac534c6d16021907633722e7602bda7a4aa9af97a7ceb8fb", "artifact_version": "T0zXWcyF3VpUwhTgzjxCRwoBrvSvb07b", "workflow_revision": "3d2359e61d986f0db8ca7218fc8e3251a41a6103", "controller_revision": "f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8", "environment_generation": 1}	519fd48bfef32900871ac27d6d0a3843aab91e2c675d1ee56e99f0578d250479	5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e	deploy	\N	2026-09-13 20:33:02.078952+00	2026-09-13 20:33:02.078953+00	f	f	t	approved	\N	\N	\N	\N
revoked	staging	{"fault": "none", "stack": "arn:aws:cloudformation:eu-west-1:728616601473:stack/aa-wf15l-staging/20936890-af97-11f1-879a-0afb2c52a213", "bucket": "aa-wf15l-728616601473-eu-west-1-artifacts", "region": "eu-west-1", "account": "728616601473", "artifact": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "function": "aa-wf15l-staging", "candidate": "healthy", "health_url": "https://1h4l6ktvd1.execute-api.eu-west-1.amazonaws.com/health", "environment": "staging", "artifact_key": "releases/5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "health_policy": "one-bounded-health-sample-v1", "expected_prior": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "rollback_policy": "restore-retained-on-failed-health-v1", "rollback_target": {"artifact": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "candidate": "baseline", "artifact_key": "releases/e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "artifact_source": "23f34a34d07529f09ec1ced68003e98c694c1bce", "template_sha256": "266077f52a321c716a596793c09952cb16e1d629fb48aad09f1d2891fd4f9b77", "artifact_version": "n50J6uoiBZXtkGaXzJMxzNuZ3w5Zhgis"}, "template_sha256": "fe1b9f134056db40168f0d2ca06496001cfc72addaaaa5a405fdfb6eeef242f3", "artifact_version": "1bKgxlvkbp5uDwndsKINrxNr360IyVeI", "workflow_revision": "3d2359e61d986f0db8ca7218fc8e3251a41a6103", "controller_revision": "f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8", "environment_generation": 0}	a5cdfa1a68b002f55c97bf4600f5e00ff408032f63770b87cb14828b6573c0d8	e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17	deploy	\N	2026-09-13 20:33:02.086196+00	2026-09-13 20:33:02.086197+00	t	f	t	approved	\N	\N	\N	\N
expired	staging	{"fault": "none", "stack": "arn:aws:cloudformation:eu-west-1:728616601473:stack/aa-wf15l-staging/20936890-af97-11f1-879a-0afb2c52a213", "bucket": "aa-wf15l-728616601473-eu-west-1-artifacts", "region": "eu-west-1", "account": "728616601473", "artifact": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "function": "aa-wf15l-staging", "candidate": "healthy", "health_url": "https://1h4l6ktvd1.execute-api.eu-west-1.amazonaws.com/health", "environment": "staging", "artifact_key": "releases/5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "health_policy": "one-bounded-health-sample-v1", "expected_prior": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "rollback_policy": "restore-retained-on-failed-health-v1", "rollback_target": {"artifact": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "candidate": "baseline", "artifact_key": "releases/e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "artifact_source": "23f34a34d07529f09ec1ced68003e98c694c1bce", "template_sha256": "266077f52a321c716a596793c09952cb16e1d629fb48aad09f1d2891fd4f9b77", "artifact_version": "n50J6uoiBZXtkGaXzJMxzNuZ3w5Zhgis"}, "template_sha256": "fe1b9f134056db40168f0d2ca06496001cfc72addaaaa5a405fdfb6eeef242f3", "artifact_version": "1bKgxlvkbp5uDwndsKINrxNr360IyVeI", "workflow_revision": "3d2359e61d986f0db8ca7218fc8e3251a41a6103", "controller_revision": "f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8", "environment_generation": 0}	a5cdfa1a68b002f55c97bf4600f5e00ff408032f63770b87cb14828b6573c0d8	e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17	deploy	\N	2026-09-13 17:33:01.092383+00	2026-09-13 20:33:02.092385+00	f	f	t	approved	\N	\N	\N	\N
wrong-workflow	staging	{"fault": "none", "stack": "arn:aws:cloudformation:eu-west-1:728616601473:stack/aa-wf15l-staging/20936890-af97-11f1-879a-0afb2c52a213", "bucket": "aa-wf15l-728616601473-eu-west-1-artifacts", "region": "eu-west-1", "account": "728616601473", "artifact": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "function": "aa-wf15l-staging", "candidate": "healthy", "health_url": "https://1h4l6ktvd1.execute-api.eu-west-1.amazonaws.com/health", "environment": "staging", "artifact_key": "releases/5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "health_policy": "one-bounded-health-sample-v1", "expected_prior": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "rollback_policy": "restore-retained-on-failed-health-v1", "rollback_target": {"artifact": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "candidate": "baseline", "artifact_key": "releases/e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "artifact_source": "23f34a34d07529f09ec1ced68003e98c694c1bce", "template_sha256": "266077f52a321c716a596793c09952cb16e1d629fb48aad09f1d2891fd4f9b77", "artifact_version": "n50J6uoiBZXtkGaXzJMxzNuZ3w5Zhgis"}, "template_sha256": "fe1b9f134056db40168f0d2ca06496001cfc72addaaaa5a405fdfb6eeef242f3", "artifact_version": "1bKgxlvkbp5uDwndsKINrxNr360IyVeI", "workflow_revision": "0000000000000000000000000000000000000000", "controller_revision": "f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8", "environment_generation": 0}	b19427ac4cbb8677f18a5a4579f06e6e73c23f75bed2e496fcfa88420de148d3	e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17	deploy	\N	2026-09-13 20:33:02.101714+00	2026-09-13 20:33:02.101716+00	f	f	t	approved	\N	\N	\N	\N
staging-release	staging	{"fault": "create", "stack": "arn:aws:cloudformation:eu-west-1:728616601473:stack/aa-wf15l-staging/20936890-af97-11f1-879a-0afb2c52a213", "bucket": "aa-wf15l-728616601473-eu-west-1-artifacts", "region": "eu-west-1", "account": "728616601473", "artifact": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "function": "aa-wf15l-staging", "candidate": "healthy", "health_url": "https://1h4l6ktvd1.execute-api.eu-west-1.amazonaws.com/health", "environment": "staging", "artifact_key": "releases/5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "health_policy": "one-bounded-health-sample-v1", "expected_prior": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "rollback_policy": "restore-retained-on-failed-health-v1", "rollback_target": {"artifact": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "candidate": "baseline", "artifact_key": "releases/e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "artifact_source": "23f34a34d07529f09ec1ced68003e98c694c1bce", "template_sha256": "266077f52a321c716a596793c09952cb16e1d629fb48aad09f1d2891fd4f9b77", "artifact_version": "n50J6uoiBZXtkGaXzJMxzNuZ3w5Zhgis"}, "template_sha256": "fe1b9f134056db40168f0d2ca06496001cfc72addaaaa5a405fdfb6eeef242f3", "artifact_version": "1bKgxlvkbp5uDwndsKINrxNr360IyVeI", "workflow_revision": "3d2359e61d986f0db8ca7218fc8e3251a41a6103", "controller_revision": "f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8", "environment_generation": 0}	755e63b8716b44a0472af6cf7ffc939c2de32bdc21a73405a378b3aa6dc19a4d	e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17	deploy	\N	2026-09-13 20:33:02.057776+00	2026-09-13 20:33:02.057777+00	f	f	t	claimed	34771962538	1	2026-09-13 17:34:02.77+00	\N
\.


--
-- Data for Name: environments; Type: TABLE DATA; Schema: execution; Owner: aa_execution
--

COPY execution.environments (id, owner, current_release, generation, hold) FROM stdin;
prod	\N	e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17	0	f
staging	staging-release	e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17	1	f
\.


--
-- Data for Name: inbox; Type: TABLE DATA; Schema: execution; Owner: aa_execution
--

COPY execution.inbox (id, digest, payload, verdict) FROM stdin;
\.


--
-- Data for Name: journal; Type: TABLE DATA; Schema: execution; Owner: aa_execution
--

COPY execution.journal (id, command, result) FROM stdin;
1	{"id": "revoked", "op": "claim", "env": "staging", "run": "34771958467", "attempt": 1, "context": "execution", "manifest": {"fault": "none", "stack": "arn:aws:cloudformation:eu-west-1:728616601473:stack/aa-wf15l-staging/20936890-af97-11f1-879a-0afb2c52a213", "bucket": "aa-wf15l-728616601473-eu-west-1-artifacts", "region": "eu-west-1", "account": "728616601473", "artifact": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "function": "aa-wf15l-staging", "candidate": "healthy", "health_url": "https://1h4l6ktvd1.execute-api.eu-west-1.amazonaws.com/health", "environment": "staging", "artifact_key": "releases/5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "health_policy": "one-bounded-health-sample-v1", "expected_prior": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "rollback_policy": "restore-retained-on-failed-health-v1", "rollback_target": {"artifact": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "candidate": "baseline", "artifact_key": "releases/e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "artifact_source": "23f34a34d07529f09ec1ced68003e98c694c1bce", "template_sha256": "266077f52a321c716a596793c09952cb16e1d629fb48aad09f1d2891fd4f9b77", "artifact_version": "n50J6uoiBZXtkGaXzJMxzNuZ3w5Zhgis"}, "template_sha256": "fe1b9f134056db40168f0d2ca06496001cfc72addaaaa5a405fdfb6eeef242f3", "artifact_version": "1bKgxlvkbp5uDwndsKINrxNr360IyVeI", "workflow_revision": "3d2359e61d986f0db8ca7218fc8e3251a41a6103", "controller_revision": "f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8", "environment_generation": 0}, "authentication_expiry": 1789321136}	{"reason": "authority-closed", "verdict": "rejected"}
2	{"id": "expired", "op": "claim", "env": "staging", "run": "34771959663", "attempt": 1, "context": "execution", "manifest": {"fault": "none", "stack": "arn:aws:cloudformation:eu-west-1:728616601473:stack/aa-wf15l-staging/20936890-af97-11f1-879a-0afb2c52a213", "bucket": "aa-wf15l-728616601473-eu-west-1-artifacts", "region": "eu-west-1", "account": "728616601473", "artifact": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "function": "aa-wf15l-staging", "candidate": "healthy", "health_url": "https://1h4l6ktvd1.execute-api.eu-west-1.amazonaws.com/health", "environment": "staging", "artifact_key": "releases/5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "health_policy": "one-bounded-health-sample-v1", "expected_prior": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "rollback_policy": "restore-retained-on-failed-health-v1", "rollback_target": {"artifact": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "candidate": "baseline", "artifact_key": "releases/e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "artifact_source": "23f34a34d07529f09ec1ced68003e98c694c1bce", "template_sha256": "266077f52a321c716a596793c09952cb16e1d629fb48aad09f1d2891fd4f9b77", "artifact_version": "n50J6uoiBZXtkGaXzJMxzNuZ3w5Zhgis"}, "template_sha256": "fe1b9f134056db40168f0d2ca06496001cfc72addaaaa5a405fdfb6eeef242f3", "artifact_version": "1bKgxlvkbp5uDwndsKINrxNr360IyVeI", "workflow_revision": "3d2359e61d986f0db8ca7218fc8e3251a41a6103", "controller_revision": "f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8", "environment_generation": 0}, "authentication_expiry": 1789321140}	{"reason": "authority-closed", "verdict": "rejected"}
3	{"id": "staging-release", "op": "claim", "env": "staging", "run": "34771962538", "attempt": 1, "context": "execution", "manifest": {"fault": "create", "stack": "arn:aws:cloudformation:eu-west-1:728616601473:stack/aa-wf15l-staging/20936890-af97-11f1-879a-0afb2c52a213", "bucket": "aa-wf15l-728616601473-eu-west-1-artifacts", "region": "eu-west-1", "account": "728616601473", "artifact": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "function": "aa-wf15l-staging", "candidate": "healthy", "health_url": "https://1h4l6ktvd1.execute-api.eu-west-1.amazonaws.com/health", "environment": "staging", "artifact_key": "releases/5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "health_policy": "one-bounded-health-sample-v1", "expected_prior": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "rollback_policy": "restore-retained-on-failed-health-v1", "rollback_target": {"artifact": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "candidate": "baseline", "artifact_key": "releases/e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "artifact_source": "23f34a34d07529f09ec1ced68003e98c694c1bce", "template_sha256": "266077f52a321c716a596793c09952cb16e1d629fb48aad09f1d2891fd4f9b77", "artifact_version": "n50J6uoiBZXtkGaXzJMxzNuZ3w5Zhgis"}, "template_sha256": "fe1b9f134056db40168f0d2ca06496001cfc72addaaaa5a405fdfb6eeef242f3", "artifact_version": "1bKgxlvkbp5uDwndsKINrxNr360IyVeI", "workflow_revision": "3d2359e61d986f0db8ca7218fc8e3251a41a6103", "controller_revision": "f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8", "environment_generation": 0}, "authentication_expiry": 1789321142}	{"verdict": "claim-admitted", "generation": 1, "consumed_at": "2026-09-13T17:34:02.770Z"}
4	{"id": "staging-release", "op": "claim", "env": "staging", "run": "34771963758", "attempt": 1, "context": "execution", "manifest": {"fault": "create", "stack": "arn:aws:cloudformation:eu-west-1:728616601473:stack/aa-wf15l-staging/20936890-af97-11f1-879a-0afb2c52a213", "bucket": "aa-wf15l-728616601473-eu-west-1-artifacts", "region": "eu-west-1", "account": "728616601473", "artifact": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "function": "aa-wf15l-staging", "candidate": "healthy", "health_url": "https://1h4l6ktvd1.execute-api.eu-west-1.amazonaws.com/health", "environment": "staging", "artifact_key": "releases/5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "health_policy": "one-bounded-health-sample-v1", "expected_prior": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "rollback_policy": "restore-retained-on-failed-health-v1", "rollback_target": {"artifact": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "candidate": "baseline", "artifact_key": "releases/e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "artifact_source": "23f34a34d07529f09ec1ced68003e98c694c1bce", "template_sha256": "266077f52a321c716a596793c09952cb16e1d629fb48aad09f1d2891fd4f9b77", "artifact_version": "n50J6uoiBZXtkGaXzJMxzNuZ3w5Zhgis"}, "template_sha256": "fe1b9f134056db40168f0d2ca06496001cfc72addaaaa5a405fdfb6eeef242f3", "artifact_version": "1bKgxlvkbp5uDwndsKINrxNr360IyVeI", "workflow_revision": "3d2359e61d986f0db8ca7218fc8e3251a41a6103", "controller_revision": "f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8", "environment_generation": 0}, "authentication_expiry": 1789321147}	{"reason": "already-consumed", "verdict": "rejected"}
\.


--
-- Data for Name: outbox; Type: TABLE DATA; Schema: execution; Owner: aa_execution
--

COPY execution.outbox (id, payload, delivered) FROM stdin;
claim:staging-release	{"run": "34771962538", "digest": "755e63b8716b44a0472af6cf7ffc939c2de32bdc21a73405a378b3aa6dc19a4d", "effect": "staging-release", "attempt": 1, "generation": 1, "consumed_at": "2026-09-13T17:34:02.770Z"}	t
\.


--
-- Data for Name: intents; Type: TABLE DATA; Schema: integrations; Owner: aa_integrations
--

COPY integrations.intents (id, digest, state, manifest, detail) FROM stdin;
staging-release	755e63b8716b44a0472af6cf7ffc939c2de32bdc21a73405a378b3aa6dc19a4d	accepted	{"fault": "create", "stack": "arn:aws:cloudformation:eu-west-1:728616601473:stack/aa-wf15l-staging/20936890-af97-11f1-879a-0afb2c52a213", "bucket": "aa-wf15l-728616601473-eu-west-1-artifacts", "region": "eu-west-1", "account": "728616601473", "artifact": "5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e", "function": "aa-wf15l-staging", "candidate": "healthy", "health_url": "https://1h4l6ktvd1.execute-api.eu-west-1.amazonaws.com/health", "environment": "staging", "artifact_key": "releases/5453e5580c753ce16ec1617f45a6d1e5bef14b51403dda7a9ede9aca77e27d0e/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "health_policy": "one-bounded-health-sample-v1", "expected_prior": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "artifact_source": "3d59892ff3fc689b65e030f1c63b5706978d27b1", "rollback_policy": "restore-retained-on-failed-health-v1", "rollback_target": {"artifact": "e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17", "candidate": "baseline", "artifact_key": "releases/e3e985a5c588bcc4db8b1d52c14d09c4613ed9b429a72c5bb69fb5dd01738b17/function.zip", "configuration": {"PROBE_ENVIRONMENT": "staging"}, "artifact_source": "23f34a34d07529f09ec1ced68003e98c694c1bce", "template_sha256": "266077f52a321c716a596793c09952cb16e1d629fb48aad09f1d2891fd4f9b77", "artifact_version": "n50J6uoiBZXtkGaXzJMxzNuZ3w5Zhgis"}, "template_sha256": "fe1b9f134056db40168f0d2ca06496001cfc72addaaaa5a405fdfb6eeef242f3", "artifact_version": "1bKgxlvkbp5uDwndsKINrxNr360IyVeI", "workflow_revision": "3d2359e61d986f0db8ca7218fc8e3251a41a6103", "controller_revision": "f3abe7fbc95a145d46e2814f5f48a1ccc0cf97f8", "environment_generation": 0}	{"run": "34771962538", "attempt": 1, "permit_expires": "2026-09-13T20:33:02.057Z"}
\.


--
-- Data for Name: journal; Type: TABLE DATA; Schema: integrations; Owner: aa_integrations
--

COPY integrations.journal (id, command, result) FROM stdin;
\.


--
-- Data for Name: outbox; Type: TABLE DATA; Schema: integrations; Owner: aa_integrations
--

COPY integrations.outbox (id, payload, delivered) FROM stdin;
\.


--
-- Data for Name: receipts; Type: TABLE DATA; Schema: integrations; Owner: aa_integrations
--

COPY integrations.receipts (id, payload) FROM stdin;
\.


--
-- Name: journal_id_seq; Type: SEQUENCE SET; Schema: execution; Owner: aa_execution
--

SELECT pg_catalog.setval('execution.journal_id_seq', 4, true);


--
-- Name: journal_id_seq; Type: SEQUENCE SET; Schema: integrations; Owner: aa_integrations
--

SELECT pg_catalog.setval('integrations.journal_id_seq', 1, false);


--
-- Name: dispatches dispatches_pkey; Type: CONSTRAINT; Schema: execution; Owner: aa_execution
--

ALTER TABLE ONLY execution.dispatches
    ADD CONSTRAINT dispatches_pkey PRIMARY KEY (run_id);


--
-- Name: effects effects_pkey; Type: CONSTRAINT; Schema: execution; Owner: aa_execution
--

ALTER TABLE ONLY execution.effects
    ADD CONSTRAINT effects_pkey PRIMARY KEY (id);


--
-- Name: environments environments_pkey; Type: CONSTRAINT; Schema: execution; Owner: aa_execution
--

ALTER TABLE ONLY execution.environments
    ADD CONSTRAINT environments_pkey PRIMARY KEY (id);


--
-- Name: inbox inbox_pkey; Type: CONSTRAINT; Schema: execution; Owner: aa_execution
--

ALTER TABLE ONLY execution.inbox
    ADD CONSTRAINT inbox_pkey PRIMARY KEY (id);


--
-- Name: journal journal_pkey; Type: CONSTRAINT; Schema: execution; Owner: aa_execution
--

ALTER TABLE ONLY execution.journal
    ADD CONSTRAINT journal_pkey PRIMARY KEY (id);


--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: execution; Owner: aa_execution
--

ALTER TABLE ONLY execution.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (id);


--
-- Name: intents intents_pkey; Type: CONSTRAINT; Schema: integrations; Owner: aa_integrations
--

ALTER TABLE ONLY integrations.intents
    ADD CONSTRAINT intents_pkey PRIMARY KEY (id);


--
-- Name: journal journal_pkey; Type: CONSTRAINT; Schema: integrations; Owner: aa_integrations
--

ALTER TABLE ONLY integrations.journal
    ADD CONSTRAINT journal_pkey PRIMARY KEY (id);


--
-- Name: outbox outbox_pkey; Type: CONSTRAINT; Schema: integrations; Owner: aa_integrations
--

ALTER TABLE ONLY integrations.outbox
    ADD CONSTRAINT outbox_pkey PRIMARY KEY (id);


--
-- Name: receipts receipts_pkey; Type: CONSTRAINT; Schema: integrations; Owner: aa_integrations
--

ALTER TABLE ONLY integrations.receipts
    ADD CONSTRAINT receipts_pkey PRIMARY KEY (id);


--
-- PostgreSQL database dump complete
--

\unrestrict L6ILpYy4d4gkXoey3bV2hbKHIk88aFD7Kks1GynxNMr6K57HLwh0HXo9fc31uDc

