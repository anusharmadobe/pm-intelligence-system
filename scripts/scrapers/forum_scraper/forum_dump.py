#!/usr/bin/env python3
"""
Config-driven forum thread dumper.

Outputs ForumThread[] JSON compatible with:
  scripts/ingest_community_forums_v2.ts
"""

import argparse
import json
import os
import re
import shutil
import sys
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options


class StructuredLogger:
    def __init__(self, module: str) -> None:
        self.module = module

    def _emit(self, level: str, message: str, **ctx: Any) -> None:
        record = {
            "ts": datetime.utcnow().isoformat() + "Z",
            "level": level,
            "module": self.module,
            "msg": message,
            **ctx,
        }
        print(json.dumps(record, ensure_ascii=True), file=sys.stderr, flush=True)

    def info(self, message: str, **ctx: Any) -> None:
        self._emit("INFO", message, **ctx)

    def warn(self, message: str, **ctx: Any) -> None:
        self._emit("WARN", message, **ctx)

    def error(self, message: str, **ctx: Any) -> None:
        self._emit("ERROR", message, **ctx)


LOGGER = StructuredLogger("forum_dump")


DEFAULT_CONFIG_PATHS = [
    "/app/config/forum_sources.json",
    os.path.join(os.getcwd(), "config", "forum_sources.json"),
    os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "config", "forum_sources.json")),
]


def parse_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None

    # Try common variants first.
    for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            pass

    # ISO-like fallback.
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None


class ForumDumper:
    def __init__(
        self,
        forum_key: str,
        config_path: Optional[str] = None,
        max_pages: Optional[int] = None,
        headless: Optional[bool] = None,
        delay: Optional[float] = None,
        test_limit: Optional[int] = None,
        since: Optional[str] = None,
    ) -> None:
        self.forum_key = forum_key
        self.raw_config = self._load_config(config_path)
        self.defaults = self.raw_config.get("defaults", {})
        self.forum = self._load_forum(self.forum_key)
        self.selectors = self.forum.get("selectors", {})

        self.base_url = self.forum.get("base_url")
        self.thread_base = self.forum.get("thread_base")
        self.forum_slug = self.forum.get("forum_slug")
        self.status_indicators = self.forum.get("status_indicators", {})
        self.max_stale_rounds = int(self.defaults.get("max_stale_rounds", 3))
        self.checkpoint_every = int(self.defaults.get("checkpoint_every", 50))

        self.max_pages = max_pages
        default_headless = bool(self.defaults.get("headless", True))
        self.headless = default_headless if headless is None else headless
        self.delay = float(self.defaults.get("delay_seconds", 2)) if delay is None else delay
        self.test_limit = test_limit
        self.since_dt = parse_date(since)
        self.driver = None

        self._validate_forum_config()
        self._init_driver()

        LOGGER.info(
            "Forum dumper initialized",
            stage="init",
            status="ok",
            forum=self.forum_key,
            base_url=self.base_url,
            headless=self.headless,
            delay=self.delay,
            max_pages=self.max_pages,
            test_limit=self.test_limit,
            since=since,
        )

    def _resolve_config_path(self, explicit_path: Optional[str]) -> str:
        if explicit_path:
            if not os.path.exists(explicit_path):
                raise FileNotFoundError(f"Config file not found: {explicit_path}")
            return explicit_path

        for candidate in DEFAULT_CONFIG_PATHS:
            if os.path.exists(candidate):
                return candidate

        raise FileNotFoundError(
            "Could not find forum config. Tried: " + ", ".join(DEFAULT_CONFIG_PATHS)
        )

    def _load_config(self, explicit_path: Optional[str]) -> Dict[str, Any]:
        path = self._resolve_config_path(explicit_path)
        with open(path, "r", encoding="utf-8") as handle:
            config = json.load(handle)
        LOGGER.info("Loaded config", stage="init", status="ok", config_path=path)
        return config

    def _load_forum(self, forum_key: str) -> Dict[str, Any]:
        forums = self.raw_config.get("forums", {})
        if forum_key not in forums:
            raise ValueError(
                f"Unknown forum '{forum_key}'. Available forums: {', '.join(sorted(forums.keys()))}"
            )
        return forums[forum_key]

    def _validate_forum_config(self) -> None:
        required_fields = ["base_url", "thread_base", "forum_slug", "selectors"]
        missing = [f for f in required_fields if not self.forum.get(f)]
        if missing:
            raise ValueError(f"Forum config for '{self.forum_key}' is missing fields: {missing}")

        required_selectors = ["load_more_button", "thread_url_pattern", "title"]
        missing_selectors = [s for s in required_selectors if not self.selectors.get(s)]
        if missing_selectors:
            raise ValueError(
                f"Forum selectors for '{self.forum_key}' are missing: {missing_selectors}"
            )

    def _init_driver(self) -> None:
        options = Options()
        if self.headless:
            options.add_argument("--headless")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        options.add_argument("--window-size=1920,1080")
        options.add_argument(
            "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        options.add_experimental_option("excludeSwitches", ["enable-logging"])

        system_chromedriver = shutil.which("chromedriver")
        if system_chromedriver:
            LOGGER.info(
                "Using system chromedriver",
                stage="driver_init",
                status="in_progress",
                path=system_chromedriver,
            )
            try:
                from selenium.webdriver.chrome.service import Service

                self.driver = webdriver.Chrome(
                    service=Service(system_chromedriver), options=options
                )
            except Exception:
                self.driver = webdriver.Chrome(
                    executable_path=system_chromedriver, options=options
                )
        else:
            from webdriver_manager.chrome import ChromeDriverManager
            from selenium.webdriver.chrome.service import Service

            path = ChromeDriverManager().install()
            LOGGER.info(
                "Downloaded chromedriver",
                stage="driver_init",
                status="in_progress",
                path=path,
            )
            self.driver = webdriver.Chrome(service=Service(path), options=options)

        LOGGER.info("Webdriver ready", stage="driver_init", status="ok")

    def _thread_url_regex(self) -> re.Pattern:
        pattern = self.selectors.get("thread_url_pattern", "/{forum_slug}/[^/]+-\\d+")
        pattern = pattern.replace("{forum_slug}", re.escape(self.forum_slug))
        return re.compile(pattern)

    def collect_question_urls(self) -> List[str]:
        urls: List[str] = []
        seen = set()

        LOGGER.info(
            "Starting URL collection",
            stage="collect_urls",
            status="in_progress",
            base_url=self.base_url,
        )
        self.driver.get(self.base_url)
        time.sleep(self.delay + 3)

        click_count = 0
        stale_rounds = 0
        url_pattern = self._thread_url_regex()

        while True:
            soup = BeautifulSoup(self.driver.page_source, "html.parser")
            links = soup.find_all("a", href=url_pattern)
            new_this_round = 0

            for link in links:
                href = link.get("href", "")
                href = re.sub(r"\?.*$", "", href)
                if not href.startswith("http"):
                    href = self.thread_base + "/" + href.lstrip("/")
                if not re.search(r"-\d{3,}$", href):
                    continue
                if href not in seen:
                    seen.add(href)
                    urls.append(href)
                    new_this_round += 1

            if new_this_round > 0:
                stale_rounds = 0
            else:
                stale_rounds += 1

            LOGGER.info(
                "URL collection round complete",
                stage="collect_urls",
                status="in_progress",
                new_urls=new_this_round,
                total_urls=len(urls),
                stale_rounds=stale_rounds,
                click_count=click_count,
            )

            if self.test_limit and len(urls) >= self.test_limit:
                urls = urls[: self.test_limit]
                LOGGER.info(
                    "Reached test limit",
                    stage="collect_urls",
                    status="ok",
                    test_limit=self.test_limit,
                )
                break

            if self.max_pages and click_count >= self.max_pages:
                LOGGER.info(
                    "Reached max page clicks",
                    stage="collect_urls",
                    status="ok",
                    max_pages=self.max_pages,
                    total_urls=len(urls),
                )
                break

            if stale_rounds >= self.max_stale_rounds:
                LOGGER.info(
                    "Reached stale round threshold",
                    stage="collect_urls",
                    status="ok",
                    max_stale_rounds=self.max_stale_rounds,
                    total_urls=len(urls),
                )
                break

            button_selector = self.selectors.get("load_more_button", ".btn--load-more")
            try:
                btn = self.driver.find_element(By.CSS_SELECTOR, button_selector)
                self.driver.execute_script("arguments[0].scrollIntoView(true);", btn)
                time.sleep(0.5)
                btn.click()
                click_count += 1
                time.sleep(self.delay)
            except Exception as err:
                LOGGER.warn(
                    "Load more button unavailable; stopping URL collection",
                    stage="collect_urls",
                    status="partial",
                    selector=button_selector,
                    error_class=err.__class__.__name__,
                    error_message=str(err),
                    total_urls=len(urls),
                )
                break

        LOGGER.info(
            "URL collection complete",
            stage="collect_urls",
            status="ok",
            total_urls=len(urls),
            total_clicks=click_count,
        )
        return urls

    def _select_text(self, soup: BeautifulSoup, selector_config: Any) -> str:
        selectors = selector_config if isinstance(selector_config, list) else [selector_config]
        for selector in selectors:
            if not selector:
                continue
            el = soup.select_one(selector)
            if el:
                text = el.get_text(strip=True)
                if text:
                    return text
        return ""

    def _extract_title(self, soup: BeautifulSoup) -> str:
        title = self._select_text(soup, self.selectors.get("title"))
        if title:
            return title
        title_tag = soup.find("title")
        if title_tag:
            return title_tag.get_text(strip=True).split(" | ")[0].strip()
        return ""

    def _extract_author(self, soup: BeautifulSoup) -> str:
        primary_selector = self.selectors.get("author")
        if primary_selector:
            author = self._select_text(soup, primary_selector)
            if author:
                return author
        fallback = soup.select_one(".author-info")
        if fallback:
            return fallback.get_text(strip=True)
        return ""

    def _extract_post_date(self, soup: BeautifulSoup) -> str:
        date_selector = self.selectors.get("date", "time[datetime]")
        date_el = soup.select_one(date_selector)
        if date_el and date_el.get("datetime"):
            dt = date_el.get("datetime")
            parsed = parse_date(dt)
            return parsed.strftime("%Y-%m-%d %H:%M:%S") if parsed else dt

        fallback = soup.select_one("time[datetime]")
        if fallback and fallback.get("datetime"):
            dt = fallback.get("datetime")
            parsed = parse_date(dt)
            return parsed.strftime("%Y-%m-%d %H:%M:%S") if parsed else dt

        return ""

    def _extract_description(self, soup: BeautifulSoup) -> str:
        selectors = self.selectors.get(
            "description",
            [
                ".threaded-topic-body-wrapper",
                ".qa-topic-post-box",
                ".post__content--new-editor",
                ".post__content",
            ],
        )
        if not isinstance(selectors, list):
            selectors = [selectors]
        for selector in selectors:
            el = soup.select_one(selector)
            if el:
                return el.get_text(separator="\n", strip=True)
        return ""

    def _extract_tags(self, soup: BeautifulSoup) -> List[str]:
        tags: List[str] = []
        tag_selector = self.selectors.get("tags", 'a[href*="search_type=tag"]')
        for el in soup.select(tag_selector):
            tag = el.get_text(strip=True)
            if tag and tag not in tags:
                tags.append(tag)
        return tags

    def _extract_stat(self, soup: BeautifulSoup, keyword: str) -> int:
        el = soup.select_one(f'[aria-label*="{keyword}"]')
        if el:
            text = el.get("aria-label", "") + " " + el.get_text(strip=True)
            match = re.search(r"(\d[\d,]*)", text)
            if match:
                return int(match.group(1).replace(",", ""))

        for selector in [f".{keyword}-count", f".{keyword}s", f'[class*="{keyword}"]']:
            el = soup.select_one(selector)
            if el:
                match = re.search(r"(\d[\d,]*)", el.get_text(strip=True))
                if match:
                    return int(match.group(1).replace(",", ""))
        return 0

    def _extract_status(self, soup: BeautifulSoup) -> str:
        status_label_selector = self.selectors.get("status_labels", ".label-component")
        labels = [el.get_text(strip=True).lower() for el in soup.select(status_label_selector)]

        resolved_terms = [s.lower() for s in self.status_indicators.get("resolved", [])]
        unresolved_terms = [s.lower() for s in self.status_indicators.get("unresolved", [])]

        for label in labels:
            if any(term in label for term in resolved_terms):
                return "resolved"
        for label in labels:
            if any(term in label for term in unresolved_terms):
                return "unresolved"

        if soup.select_one(".best-answer"):
            return "resolved"
        return "unknown"

    def _extract_replies(self, soup: BeautifulSoup) -> List[Dict[str, Any]]:
        replies: List[Dict[str, Any]] = []
        reply_selector = self.selectors.get("reply_container", ".threaded-reply-item")
        body_selector = self.selectors.get("reply_body", ".threaded-reply-body-wrapper")
        author_selector = self.selectors.get("reply_author", ".author-info")
        accepted_markers = self.selectors.get("accepted_marker", [".best-answer", ".label--success"])
        accepted_markers = accepted_markers if isinstance(accepted_markers, list) else [accepted_markers]

        for item in soup.select(reply_selector):
            reply: Dict[str, Any] = {}

            author_el = item.select_one(author_selector)
            author_text = author_el.get_text(strip=True) if author_el else ""
            author_text = re.sub(
                r"(Accepted solution|Author|Adobe Employee|Community Expert|Correct answer)$",
                "",
                author_text,
            ).strip()
            reply["author"] = author_text

            time_el = item.select_one("time[datetime]")
            if time_el and time_el.get("datetime"):
                parsed = parse_date(time_el.get("datetime"))
                reply["date"] = parsed.strftime("%Y-%m-%d %H:%M:%S") if parsed else time_el.get("datetime")
            else:
                reply["date"] = ""

            body_el = item.select_one(body_selector)
            reply["text"] = body_el.get_text(separator="\n", strip=True) if body_el else ""

            is_accepted = any(item.select_one(marker) is not None for marker in accepted_markers)
            for label in item.select(self.selectors.get("status_labels", ".label-component")):
                if "accepted solution" in label.get_text(strip=True).lower():
                    is_accepted = True
            reply["is_accepted"] = is_accepted

            like_el = item.select_one('[aria-label*="like"], [aria-label*="kudo"]')
            if like_el:
                match = re.search(
                    r"(\d+)", like_el.get("aria-label", "") + " " + like_el.get_text(strip=True)
                )
                reply["likes"] = int(match.group(1)) if match else 0
            else:
                reply["likes"] = 0

            if reply.get("text") or reply.get("author"):
                replies.append(reply)

        return replies

    def extract_thread(self, url: str) -> Dict[str, Any]:
        started = time.time()
        try:
            self.driver.get(url)
            time.sleep(self.delay)
            soup = BeautifulSoup(self.driver.page_source, "html.parser")

            thread = {
                "url": url,
                "title": self._extract_title(soup),
                "author": self._extract_author(soup),
                "date_posted": self._extract_post_date(soup),
                "description": self._extract_description(soup),
                "tags": self._extract_tags(soup),
                "views": self._extract_stat(soup, "view"),
                "replies_count": self._extract_stat(soup, "repl"),
                "likes": self._extract_stat(soup, "like") or self._extract_stat(soup, "kudo"),
                "status": self._extract_status(soup),
                "accepted_answer": None,
                "comments": [],
                "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }

            replies = self._extract_replies(soup)
            for reply in replies:
                if reply.get("is_accepted"):
                    thread["accepted_answer"] = reply
                thread["comments"].append(reply)
            thread["replies_count"] = thread["replies_count"] or len(thread["comments"])

            LOGGER.info(
                "Thread extracted",
                stage="extract_thread",
                status="ok",
                url=url,
                elapsed_ms=int((time.time() - started) * 1000),
                comments=len(thread["comments"]),
                has_accepted=thread["accepted_answer"] is not None,
            )
            return thread
        except Exception as err:
            LOGGER.error(
                "Thread extraction failed",
                stage="extract_thread",
                status="error",
                url=url,
                error_class=err.__class__.__name__,
                error_message=str(err),
                elapsed_ms=int((time.time() - started) * 1000),
            )
            return {
                "url": url,
                "error": str(err),
                "scraped_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }

    def _save(self, threads: List[Dict[str, Any]], output_file: str, checkpoint: bool = False) -> None:
        with open(output_file, "w", encoding="utf-8") as handle:
            json.dump(threads, handle, indent=2, ensure_ascii=False)
        LOGGER.info(
            "Saved output",
            stage="save",
            status="ok",
            checkpoint=checkpoint,
            output_file=output_file,
            threads=len(threads),
        )

    def _is_after_since(self, thread: Dict[str, Any]) -> bool:
        if not self.since_dt:
            return True
        posted = parse_date(thread.get("date_posted"))
        if not posted:
            return True
        return posted >= self.since_dt

    def run(self, output_file: str) -> List[Dict[str, Any]]:
        run_started = time.time()
        LOGGER.info(
            "Forum dump run started",
            stage="run",
            status="in_progress",
            forum=self.forum_key,
            output_file=output_file,
        )

        urls = self.collect_question_urls()
        if not urls:
            LOGGER.warn(
                "No thread URLs found",
                stage="run",
                status="partial",
                forum=self.forum_key,
            )
            return []

        threads: List[Dict[str, Any]] = []
        skipped_since = 0

        for index, url in enumerate(urls, 1):
            LOGGER.info(
                "Extracting thread",
                stage="run",
                status="in_progress",
                position=index,
                total=len(urls),
                url=url,
            )
            thread = self.extract_thread(url)
            if thread.get("error"):
                threads.append(thread)
            else:
                if self._is_after_since(thread):
                    threads.append(thread)
                else:
                    skipped_since += 1

            if index % self.checkpoint_every == 0:
                self._save(threads, output_file, checkpoint=True)

        self._save(threads, output_file, checkpoint=False)

        resolved = sum(1 for t in threads if t.get("status") == "resolved")
        unresolved = sum(1 for t in threads if t.get("status") == "unresolved")
        total_comments = sum(len(t.get("comments", [])) for t in threads)
        with_accepted = sum(1 for t in threads if t.get("accepted_answer"))
        errors = sum(1 for t in threads if t.get("error"))

        LOGGER.info(
            "Forum dump run complete",
            stage="run",
            status="ok",
            forum=self.forum_key,
            total_urls=len(urls),
            written_threads=len(threads),
            skipped_since=skipped_since,
            resolved=resolved,
            unresolved=unresolved,
            unknown_status=len(threads) - resolved - unresolved,
            total_comments=total_comments,
            with_accepted=with_accepted,
            errors=errors,
            elapsed_ms=int((time.time() - run_started) * 1000),
            output_file=output_file,
        )

        if self.driver:
            self.driver.quit()
            LOGGER.info("Webdriver closed", stage="run", status="ok")

        return threads


def main() -> None:
    parser = argparse.ArgumentParser(description="Config-driven full thread dump for forums")
    parser.add_argument("--forum", type=str, required=True, help="Forum key from forum_sources.json")
    parser.add_argument("--config", type=str, default=None, help="Path to forum_sources.json")
    parser.add_argument(
        "--max-pages", type=int, default=None, help="Max number of load-more clicks/page fetches"
    )
    parser.add_argument("--test", type=int, default=None, help="Limit extracted thread URLs")
    parser.add_argument("--output", type=str, required=True, help="Output JSON file path")
    parser.add_argument("--delay", type=float, default=None, help="Delay between page loads")
    parser.add_argument("--since", type=str, default=None, help="Only keep threads on/after date")
    parser.add_argument(
        "--no-headless", action="store_true", help="Run browser in visible mode"
    )
    args = parser.parse_args()

    max_pages = args.max_pages if args.max_pages and args.max_pages > 0 else None
    test_limit = args.test if args.test and args.test > 0 else None

    dumper = ForumDumper(
        forum_key=args.forum,
        config_path=args.config,
        max_pages=max_pages,
        headless=not args.no_headless,
        delay=args.delay,
        test_limit=test_limit,
        since=args.since,
    )
    dumper.run(args.output)


if __name__ == "__main__":
    main()
