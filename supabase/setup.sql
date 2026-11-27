/*      #########################################################################################################################################################
		Created: 13.11.2026, Marco
		Purpose: Database schema for the language quiz web app (parent login with child profiles and synced learning progress)
		Description: Each parent account (Supabase Auth, e-mail + password) owns one or more child profiles; the quiz progress of each child is stored as one JSON document so it follows the child across devices. Row Level Security limits every account to its own profiles and progress.

		History:
		Date		Who			Change description
		27.11.26	Marco		Add progress history (one version per practice session, kept 30 days) and rollback with progress_restore()
		#########################################################################################################################################################  */

-- Run once in the Supabase SQL editor. The script is idempotent and can be run again after changes.


/* ---------------- Tables ---------------- */

CREATE TABLE IF NOT EXISTS public.profiles (
	id				UUID		PRIMARY KEY DEFAULT gen_random_uuid(),
	-- Defaults to the logged-in parent, so the app never has to send it
	owner_id		UUID		NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
	-- First name or nickname only; no further personal data about the children is stored
	name			TEXT		NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 30),
	created_at		TIMESTAMPTZ	NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_profiles_owner_id ON public.profiles (owner_id);

CREATE TABLE IF NOT EXISTS public.progress (
	profile_id		UUID		PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
	-- Same structure as the localStorage object "franz_quiz_v1" (xp, decks, fehler, letztes, laufend, vorlesen)
	data			JSONB		NOT NULL,
	updated_at		TIMESTAMPTZ	NOT NULL DEFAULT NOW()
);


/* ---------------- Access (Row Level Security) ---------------- */

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress ENABLE ROW LEVEL SECURITY;

-- Explicit grants, because newer Supabase projects no longer expose new tables to the API automatically; anonymous visitors get nothing
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles, public.progress TO authenticated;
REVOKE ALL ON public.profiles, public.progress FROM anon;

-- A parent sees and manages only their own children
DROP POLICY IF EXISTS profiles_own ON public.profiles;
CREATE POLICY profiles_own ON public.profiles
	FOR ALL TO authenticated
	USING (owner_id = auth.uid())
	WITH CHECK (owner_id = auth.uid());

-- Progress belongs to whoever owns the profile
DROP POLICY IF EXISTS progress_own ON public.progress;
CREATE POLICY progress_own ON public.progress
	FOR ALL TO authenticated
	USING (EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.id = progress.profile_id AND p.owner_id = auth.uid()))
	WITH CHECK (EXISTS (SELECT 1 FROM public.profiles AS p WHERE p.id = progress.profile_id AND p.owner_id = auth.uid()));


/* ---------------- Keep-alive ---------------- */

-- Free Supabase projects pause after a week without database activity; the GitHub workflow calls this function twice a week
CREATE OR REPLACE FUNCTION public.ping()
RETURNS INTEGER
LANGUAGE sql
STABLE
AS $$
	SELECT 1;
$$;

GRANT EXECUTE ON FUNCTION public.ping() TO anon;


/* ---------------- History and rollback ---------------- */

-- Raised by every rollback; a device that sees a higher number drops its own copy instead of merging its changes back in
ALTER TABLE public.progress ADD COLUMN IF NOT EXISTS rollback_no INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.progress_history (
	id				BIGINT		GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	profile_id		UUID		NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
	data			JSONB		NOT NULL,
	-- The version was the current progress until this moment
	saved_at		TIMESTAMPTZ	NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_progress_history_profile_id ON public.progress_history (profile_id, saved_at DESC);

-- Only the trigger and the SQL editor touch the history; the app has no access
ALTER TABLE public.progress_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.progress_history FROM anon, authenticated;

-- Keeps the progress as it was before each practice session: the first upload after 10 quiet minutes stores the previous version
CREATE OR REPLACE FUNCTION public.progress_keep_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
	-- The app uploads every few seconds during a round, so only the start of a session is worth a version; rollbacks store their own version
	IF NEW.data IS DISTINCT FROM OLD.data
		AND NEW.rollback_no = OLD.rollback_no
		AND OLD.updated_at < NOW() - INTERVAL '10 minutes'
	THEN
		INSERT INTO public.progress_history (profile_id, data, saved_at)
		VALUES (OLD.profile_id, OLD.data, NOW());

		-- Housekeeping: versions older than 30 days are no longer needed
		DELETE FROM public.progress_history
		WHERE profile_id = OLD.profile_id
			AND saved_at < NOW() - INTERVAL '30 days';
	END IF;
	RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_progress_keep_history ON public.progress;
CREATE TRIGGER trg_progress_keep_history
	BEFORE UPDATE ON public.progress
	FOR EACH ROW EXECUTE FUNCTION public.progress_keep_history();

-- Rollback, run in the SQL editor: SELECT public.progress_restore(<history id>); see supabase/README.md
CREATE OR REPLACE FUNCTION public.progress_restore(p_history_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
	v_profile_id	UUID;
	v_data			JSONB;
	v_saved_at		TIMESTAMPTZ;
BEGIN
	SELECT
		h.profile_id,
		h.data,
		h.saved_at
	INTO v_profile_id, v_data, v_saved_at
	FROM public.progress_history AS h
	WHERE h.id = p_history_id;

	IF NOT FOUND THEN
		RAISE EXCEPTION 'History entry % does not exist', p_history_id;
	END IF;

	-- Keep the current progress as a version as well, so the rollback itself can be undone
	INSERT INTO public.progress_history (profile_id, data)
	SELECT
		pr.profile_id,
		pr.data
	FROM public.progress AS pr
	WHERE pr.profile_id = v_profile_id;

	-- The higher rollback number tells every device to take this version as it is
	UPDATE public.progress
	SET	data		= v_data,
		updated_at	= NOW(),
		rollback_no	= rollback_no + 1
	WHERE profile_id = v_profile_id;

	RETURN 'Progress restored to the version before ' || to_char(v_saved_at AT TIME ZONE 'Europe/Zurich', 'DD.MM.YYYY HH24:MI');
END;
$$;

-- Supabase would otherwise offer both functions to the app as RPC endpoints
REVOKE ALL ON FUNCTION public.progress_keep_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.progress_restore(BIGINT) FROM PUBLIC, anon, authenticated;
