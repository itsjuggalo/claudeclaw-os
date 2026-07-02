#!/usr/bin/env python3
"""
exercise_clip.py — on-demand exercise demo clips with a locked 3D model.

Flow: name -> (cache check in Supabase) -> Gemini defines the exercise ->
Nano Banana renders start + peak poses of the LOCKED model -> Seedance i2v
(first frame + end_frame) renders the range of motion -> ffmpeg ping-pongs it
into a seamless loop -> upload mp4 to Supabase + insert metadata row -> print
JSON {status, path, name, ...} on stdout for the agent to send.

Usage:
  python3 exercise_clip.py "barbell back squat"
  python3 exercise_clip.py "push up" --force      # ignore cache, regenerate
"""
import os, sys, re, io, json, time, base64, mimetypes, subprocess, tempfile, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REF_IMG = os.path.join(HERE, "assets", "model_reference.png")
CACHE_DIR = os.path.join(HERE, "cache")
os.makedirs(CACHE_DIR, exist_ok=True)
BUCKET = "exercise-clips"
IMG_MODEL = "gemini-3-pro-image-preview"
TEXT_MODEL = "gemini-3.5-flash"

# ---- env -------------------------------------------------------------------
def load_env():
    p = os.path.expanduser("~/.env")
    if os.path.exists(p):
        for line in open(p):
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
load_env()

SUPA_URL = os.environ["HEALTH_SUPABASE_URL"].rstrip("/")
SUPA_KEY = os.environ["HEALTH_SUPABASE_SERVICE_ROLE_KEY"]
DB_PW = os.environ["HEALTH_SUPABASE_DB_PASSWORD"]
DB_REF = os.environ["HEALTH_SUPABASE_PROJECT_REF"]
ATLAS_KEY = os.environ["ATLASCLOUD_API_KEY"]

def log(*a):
    print(*a, file=sys.stderr, flush=True)

def slugify(s):
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", s.lower())).strip("-")

# ---- supabase postgres -----------------------------------------------------
def db_conn():
    import psycopg2
    for host, user in [(f"db.{DB_REF}.supabase.co", "postgres"),
                       (f"aws-0-ca-central-1.pooler.supabase.com", f"postgres.{DB_REF}")]:
        try:
            return psycopg2.connect(host=host, port=5432, user=user, password=DB_PW,
                                    dbname="postgres", sslmode="require", connect_timeout=10)
        except Exception as e:
            log("db conn fail", host, str(e).splitlines()[0][:80])
    raise SystemExit("no db connection")

def get_cached(slug):
    c = db_conn(); cur = c.cursor()
    cur.execute("select name, body_part, target, equipment, secondary_muscles, instructions, "
                "description, storage_path from exercise_clips where slug=%s", (slug,))
    r = cur.fetchone(); c.close()
    if not r:
        return None
    keys = ["name","body_part","target","equipment","secondary_muscles","instructions","description","storage_path"]
    return dict(zip(keys, r))

def insert_row(meta, slug, storage_path, dur):
    c = db_conn(); c.autocommit = True; cur = c.cursor()
    cur.execute(
        "insert into exercise_clips (slug,name,body_part,target,equipment,secondary_muscles,"
        "instructions,description,engine,storage_path,duration_seconds) "
        "values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) on conflict (slug) do update set "
        "storage_path=excluded.storage_path",
        (slug, meta["name"], meta.get("body_part"), meta.get("target"), meta.get("equipment"),
         meta.get("secondary_muscles") or [], meta.get("instructions") or [], meta.get("description"),
         "seedance-i2v", storage_path, dur))
    c.close()

# ---- supabase storage ------------------------------------------------------
def upload(local, storage_path, content_type="video/mp4"):
    url = f"{SUPA_URL}/storage/v1/object/{BUCKET}/{storage_path}"
    data = open(local, "rb").read()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "Authorization": f"Bearer {SUPA_KEY}", "apikey": SUPA_KEY,
        "x-upsert": "true", "Content-Type": content_type})
    urllib.request.urlopen(req, timeout=120).read()

def download(storage_path, local):
    url = f"{SUPA_URL}/storage/v1/object/{BUCKET}/{storage_path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {SUPA_KEY}", "apikey": SUPA_KEY})
    with open(local, "wb") as f:
        f.write(urllib.request.urlopen(req, timeout=120).read())
    return local

# ---- gemini ----------------------------------------------------------------
def gem_client():
    from google import genai
    return genai.Client()

def define_exercise(name):
    """Return metadata + visual pose/motion descriptions for the locked model."""
    from google.genai import types
    c = gem_client()
    prompt = (
        f'Define the strength/fitness exercise "{name}" for an animation pipeline. Return JSON with keys: '
        'name (clean display name), body_part, target (primary muscle), equipment, '
        'secondary_muscles (array of strings), instructions (array of 3-5 short imperative steps), '
        'description (one sentence), '
        'start_pose (a precise VISUAL description of the model at the START of the rep — body position, '
        'limb angles, any equipment held, front-facing, full body), '
        'peak_pose (a precise VISUAL description of the model at the PEAK/bottom of the rep — the point of '
        'maximum range of motion, front-facing, full body), '
        'motion (one sentence describing the movement from start to peak). '
        'Keep poses front-facing and full-body. If equipment is held, describe it simply.'
    )
    S = types.Schema
    T = types.Type
    schema = S(type=T.OBJECT, properties={
        "name": S(type=T.STRING), "body_part": S(type=T.STRING), "target": S(type=T.STRING),
        "equipment": S(type=T.STRING),
        "secondary_muscles": S(type=T.ARRAY, items=S(type=T.STRING)),
        "instructions": S(type=T.ARRAY, items=S(type=T.STRING)),
        "description": S(type=T.STRING), "start_pose": S(type=T.STRING),
        "peak_pose": S(type=T.STRING), "motion": S(type=T.STRING),
    }, required=["name","body_part","target","equipment","secondary_muscles","instructions",
                 "description","start_pose","peak_pose","motion"])
    r = c.models.generate_content(
        model=TEXT_MODEL, contents=prompt,
        config=types.GenerateContentConfig(response_mime_type="application/json", response_schema=schema))
    txt = r.text.strip()
    if txt.startswith("```"):
        txt = txt.strip("`")
        txt = txt[txt.find("{"):txt.rfind("}")+1]
    return json.loads(txt)

def gen_pose(anchor_path, pose_text, out_path):
    from PIL import Image
    c = gem_client()
    anchor = Image.open(anchor_path).convert("RGB")
    instr = (
        "Use the EXACT SAME character as in this reference image: same face, same body, same charcoal "
        "athletic shirt, same black shorts, same gray shoes, same clean 3D-rendered style. Keep a PURE "
        "SOLID WHITE seamless background (#ffffff), the same soft even lighting, a FRONT-FACING camera "
        "angle, and full-body framing (whole body head to toe, centered, even margin). Change ONLY the "
        f"pose to: {pose_text}. Square 1:1. No text, no logos, no extra people."
    )
    for _ in range(3):
        try:
            r = c.models.generate_content(model=IMG_MODEL, contents=[anchor, instr])
            for p in r.candidates[0].content.parts:
                d = getattr(p, "inline_data", None)
                if d and d.data:
                    Image.open(io.BytesIO(d.data)).convert("RGB").save(out_path)
                    return out_path
        except Exception as e:
            log("gen_pose err:", str(e).splitlines()[0][:80])
    raise SystemExit(f"failed to generate pose: {pose_text[:40]}")

def qc_poses(name, start_path, peak_path):
    """Best-effort vision QC of the two keyframes. Returns (ok, reason)."""
    from PIL import Image
    try:
        c = gem_client()
        s, p = Image.open(start_path), Image.open(peak_path)
        r = c.models.generate_content(model=TEXT_MODEL, contents=[
            f'These are the START (first image) and PEAK (second image) frames of the exercise "{name}". '
            'Is this anatomically correct form, with a clearly different and correct peak position? '
            'Answer strictly as JSON: {"ok": true/false, "reason": "..."}', s, p])
        t = r.text.strip().strip("`")
        t = t[t.find("{"):t.rfind("}")+1]
        j = json.loads(t)
        return bool(j.get("ok")), j.get("reason", "")
    except Exception as e:
        log("qc skipped:", str(e).splitlines()[0][:60])
        return True, "qc-skipped"

# ---- seedance i2v ----------------------------------------------------------
def seedance_i2v(start_path, end_path, motion, out_path):
    import requests
    def durl(p):
        m = mimetypes.guess_type(p)[0] or "image/png"
        return f"data:{m};base64," + base64.b64encode(open(p, "rb").read()).decode()
    H = {"Content-Type": "application/json", "Authorization": f"Bearer {ATLAS_KEY}"}
    prompt = (motion + " The character stays facing the camera. The pure solid white background and the "
              "character's appearance stay exactly the same. Static locked-off camera, no zoom, no pan, "
              "no text, no captions.")
    body = {"model": "bytedance/seedance-2.0/image-to-video", "prompt": prompt, "duration": 5,
            "resolution": "720p", "ratio": "1:1", "generate_audio": False, "watermark": False,
            "image": durl(start_path), "end_frame": durl(end_path)}
    r = requests.post("https://api.atlascloud.ai/api/v1/model/generateVideo", headers=H, json=body, timeout=90)
    r.raise_for_status()
    pid = r.json()["data"]["id"]
    poll = f"https://api.atlascloud.ai/api/v1/model/prediction/{pid}"
    for _ in range(150):
        time.sleep(4)
        s = requests.get(poll, headers={"Authorization": f"Bearer {ATLAS_KEY}"}, timeout=60).json()
        st = s["data"]["status"]
        if st in ("completed", "succeeded"):
            open(out_path, "wb").write(requests.get(s["data"]["outputs"][0], timeout=120).content)
            return out_path
        if st in ("failed", "timeout"):
            raise SystemExit("seedance failed: " + str(s["data"].get("error"))[:120])
    raise SystemExit("seedance timed out")

def pingpong(src, out):
    d = tempfile.mkdtemp()
    rev = os.path.join(d, "rev.mp4"); lst = os.path.join(d, "l.txt")
    subprocess.run(["ffmpeg","-y","-hide_banner","-loglevel","error","-i",src,"-vf","reverse",rev], check=True)
    open(lst,"w").write(f"file '{src}'\nfile '{rev}'\n")
    r = subprocess.run(["ffmpeg","-y","-hide_banner","-loglevel","error","-f","concat","-safe","0",
                        "-i",lst,"-c","copy",out])
    if r.returncode != 0:
        subprocess.run(["ffmpeg","-y","-hide_banner","-loglevel","error","-f","concat","-safe","0",
                        "-i",lst,"-pix_fmt","yuv420p",out], check=True)
    return out

# ---- main ------------------------------------------------------------------
def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    force = "--force" in sys.argv
    if not args:
        print(json.dumps({"status": "error", "error": "no exercise name given"})); return
    name_in = " ".join(args)
    slug = slugify(name_in)

    if not force:
        hit = get_cached(slug)
        if hit:
            local = os.path.join(CACHE_DIR, f"{slug}.mp4")
            if not os.path.exists(local):
                download(hit["storage_path"], local)
            out = {"status": "hit", "path": local, "slug": slug, **{k: hit[k] for k in
                   ("name","body_part","target","equipment","secondary_muscles","instructions","description")}}
            print(json.dumps(out)); return

    log("defining", name_in)
    meta = define_exercise(name_in)
    meta["name"] = meta.get("name") or name_in

    start_png = os.path.join(CACHE_DIR, f"{slug}_start.png")
    peak_png = os.path.join(CACHE_DIR, f"{slug}_peak.png")
    log("rendering start pose")
    gen_pose(REF_IMG, meta["start_pose"], start_png)
    log("rendering peak pose")
    gen_pose(start_png, meta["peak_pose"], peak_png)

    ok, reason = qc_poses(meta["name"], start_png, peak_png)
    if not ok:
        log("QC fail, retrying peak:", reason)
        gen_pose(start_png, meta["peak_pose"] + " Ensure the peak range of motion is clearly reached.", peak_png)

    log("rendering motion (seedance i2v)")
    down = os.path.join(CACHE_DIR, f"{slug}_down.mp4")
    seedance_i2v(start_png, peak_png, meta["motion"], down)
    final = os.path.join(CACHE_DIR, f"{slug}.mp4")
    log("ping-pong loop")
    pingpong(down, final)

    storage_path = f"clips/{slug}.mp4"
    log("uploading + recording")
    upload(final, storage_path)
    insert_row(meta, slug, storage_path, 10.0)

    out = {"status": "generated", "path": final, "slug": slug,
           **{k: meta.get(k) for k in ("name","body_part","target","equipment",
              "secondary_muscles","instructions","description")}}
    print(json.dumps(out))

if __name__ == "__main__":
    main()
