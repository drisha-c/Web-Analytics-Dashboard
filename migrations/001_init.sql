CREATE TABLE users (
  id bigserial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE websites (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  domain text NOT NULL,
  site_key text NOT NULL UNIQUE,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX websites_user_idx ON websites(user_id);
-- Visitors/sessions are keyed per website so ids can never leak across sites.
CREATE TABLE visitors (
  website_id bigint NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  first_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (website_id, id)
);
CREATE TABLE sessions (
  website_id bigint NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  visitor_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  referrer text,
  channel text NOT NULL,
  utm_source text, utm_medium text, utm_campaign text,
  device text NOT NULL, browser text NOT NULL, os text NOT NULL, screen text,
  PRIMARY KEY (website_id, id),
  FOREIGN KEY (website_id, visitor_id) REFERENCES visitors(website_id, id) ON DELETE CASCADE
);
CREATE INDEX sessions_started_idx ON sessions(website_id, started_at);
CREATE INDEX sessions_visitor_idx ON sessions(website_id, visitor_id);
CREATE TABLE events (
  id bigserial PRIMARY KEY,
  website_id bigint NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
  session_id uuid NOT NULL,
  visitor_id uuid NOT NULL,
  type text NOT NULL CHECK (type IN ('pageview','event')),
  name text NOT NULL,
  url text, path text NOT NULL, title text,
  props jsonb NOT NULL DEFAULT '{}',
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (website_id, session_id) REFERENCES sessions(website_id, id) ON DELETE CASCADE,
  FOREIGN KEY (website_id, visitor_id) REFERENCES visitors(website_id, id) ON DELETE CASCADE
);
CREATE INDEX events_site_time_idx ON events(website_id, created_at);
CREATE INDEX events_site_type_time_idx ON events(website_id, type, created_at);
CREATE INDEX events_site_path_idx ON events(website_id, path);
CREATE INDEX events_session_idx ON events(website_id, session_id);
