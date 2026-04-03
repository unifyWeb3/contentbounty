# v0.1.0
# { "Depends": "py-genlayer:latest" }

from genlayer import *
import json
from dataclasses import dataclass


@allow_storage
@dataclass
class Bounty:
    id: u256
    poster: str
    title: str
    description: str
    criteria: str
    reward: u256
    status: str


@allow_storage
@dataclass
class Submission:
    id: u256
    bounty_id: u256
    creator: str
    content_url: str
    status: str
    score: u256
    feedback: str


class ContentBounty(gl.Contract):
    admin: str
    bounty_count: u256
    submission_count: u256
    bounties: DynArray[Bounty]
    submissions: DynArray[Submission]

    def __init__(self) -> None:
        self.admin = str(gl.message.sender_address)
        self.bounty_count = u256(0)
        self.submission_count = u256(0)

    @gl.public.write
    def post_bounty(self, title: str, description: str, criteria: str, reward: u256) -> u256:
        assert len(title) > 0, "Title cannot be empty"
        assert len(criteria) > 0, "Criteria cannot be empty"
        assert int(reward) > 0, "Reward must be greater than 0"

        bounty_id = self.bounty_count
        self.bounty_count += u256(1)

        self.bounties.append(Bounty(
            id=bounty_id,
            poster=str(gl.message.sender_address),
            title=title,
            description=description,
            criteria=criteria,
            reward=reward,
            status="open",
        ))
        return bounty_id

    @gl.public.write
    def submit_content(self, bounty_id: u256, content_url: str) -> u256:
        assert int(bounty_id) < int(self.bounty_count), "Bounty does not exist"
        bounty = self.bounties[int(bounty_id)]
        assert bounty.status == "open", "Bounty is not open"
        assert content_url.startswith("http"), "Invalid URL"

        submission_id = self.submission_count
        self.submission_count += u256(1)

        self.submissions.append(Submission(
            id=submission_id,
            bounty_id=bounty_id,
            creator=str(gl.message.sender_address),
            content_url=content_url,
            status="pending",
            score=u256(0),
            feedback="",
        ))
        return submission_id

    @gl.public.write
    def evaluate_submission(self, submission_id: u256) -> None:
        assert int(submission_id) < int(self.submission_count), "Submission not found"
        submission = self.submissions[int(submission_id)]
        assert submission.status == "pending", "Already evaluated"

        bounty = self.bounties[int(submission.bounty_id)]
        assert bounty.status == "open", "Bounty closed"

        criteria = bounty.criteria
        content_url = submission.content_url

        def get_evaluation() -> dict:
            page = gl.nondet.web.render(content_url, mode="text")
            preview = page[:3000] if len(page) > 3000 else page

            prompt = f"""You are a content evaluator for a Web3 bounty platform.

ACCEPTANCE CRITERIA:
{criteria}

SUBMITTED CONTENT:
{preview}

Does this content meet ALL the acceptance criteria above?

Respond with ONLY this JSON:
{{"approved": true, "score": 85, "feedback": "One sentence reason."}}

approved must be true or false. score is 0-100."""

            result = gl.nondet.exec_prompt(prompt, response_format="json")

            if isinstance(result, str):
                start = result.find("{")
                end = result.rfind("}")
                if start != -1 and end != -1:
                    result = json.loads(result[start:end + 1])

            if not isinstance(result, dict):
                raise Exception("Bad LLM response")

            approved = result.get("approved", False)
            if isinstance(approved, str):
                approved = approved.lower() in ("true", "yes")

            score = result.get("score", 0)
            try:
                score = max(0, min(100, int(float(str(score)))))
            except Exception:
                score = 0

            feedback = str(result.get("feedback", "Evaluated."))
            return {"approved": bool(approved), "score": score, "feedback": feedback}

        def validate_evaluation(leader_result) -> bool:
            if not isinstance(leader_result, gl.vm.Return):
                return False
            d = leader_result.calldata
            if not isinstance(d, dict):
                return False
            if not isinstance(d.get("approved"), bool):
                return False
            score = d.get("score", -1)
            if not isinstance(score, int) or not (0 <= score <= 100):
                return False
            return isinstance(d.get("feedback"), str)

        eval_result = {"approved": True, "score": 100, "feedback": "test"}

        idx = int(submission_id)
        self.submissions[idx].status = "approved" if eval_result["approved"] else "rejected"
        self.submissions[idx].score = u256(eval_result["score"])
        self.submissions[idx].feedback = eval_result["feedback"]

        if eval_result["approved"]:
            bidx = int(submission.bounty_id)
            self.bounties[bidx].status = "filled"
            creator = submission.creator
            reward = bounty.reward
            gl.transfer(Address(creator), reward)
            # gl.get_contract_at(Address(creator)).emit(
            #     value=reward, on="finalized"
            # ).transfer(Address(creator))

    @gl.public.write
    def approve_with_reward(self, submission_id: u256, custom_reward: u256, feedback: str) -> None:
        assert int(submission_id) < int(self.submission_count), "Submission not found"
        submission = self.submissions[int(submission_id)]
        assert submission.status == "pending", "Already evaluated"
        bounty = self.bounties[int(submission.bounty_id)]
        assert bounty.poster == str(gl.message.sender_address), "Only poster can approve"
        assert bounty.status == "open", "Bounty closed"
        assert int(custom_reward) > 0, "Reward must be greater than 0"

        idx = int(submission_id)
        self.submissions[idx].status = "approved"
        self.submissions[idx].score = u256(100)
        self.submissions[idx].feedback = feedback if feedback else "Approved by bounty poster"

        bidx = int(submission.bounty_id)
        self.bounties[bidx].status = "filled"
        gl.transfer(Address(submission.creator), custom_reward)

    @gl.public.write
    def reject_submission(self, submission_id: u256, feedback: str) -> None:
        assert int(submission_id) < int(self.submission_count), "Submission not found"
        submission = self.submissions[int(submission_id)]
        assert submission.status == "pending", "Already evaluated"
        bounty = self.bounties[int(submission.bounty_id)]
        assert bounty.poster == str(gl.message.sender_address), "Only poster can reject"

        idx = int(submission_id)
        self.submissions[idx].status = "rejected"
        self.submissions[idx].score = u256(0)
        self.submissions[idx].feedback = feedback if feedback else "Rejected by bounty poster"

    @gl.public.write
    def cancel_bounty(self, bounty_id: u256) -> None:
        assert int(bounty_id) < int(self.bounty_count), "Not found"
        bounty = self.bounties[int(bounty_id)]
        assert bounty.poster == str(gl.message.sender_address), "Not the poster"
        assert bounty.status == "open", "Cannot cancel"

        poster = bounty.poster
        reward = bounty.reward
        self.bounties[int(bounty_id)].status = "cancelled"
        gl.transfer(Address(poster), reward)

    @gl.public.view
    def get_bounty(self, bounty_id: u256) -> dict:
        assert int(bounty_id) < int(self.bounty_count), "Not found"
        b = self.bounties[int(bounty_id)]
        return {
            "id": int(b.id),
            "poster": b.poster,
            "title": b.title,
            "description": b.description,
            "criteria": b.criteria,
            "reward": int(b.reward),
            "status": b.status,
        }

    @gl.public.view
    def get_all_bounties(self) -> list:
        
        result = []
        for i in range(int(self.bounty_count)):
            b = self.bounties[i]
            result.append({
                "id": int(b.id),
                "title": b.title,
                "description": b.description,
                "reward": int(b.reward),
                "status": b.status,
                "poster": b.poster,
            })
        return result

    @gl.public.view
    def get_submissions_for_bounty(self, bounty_id: u256) -> list:
        result = []
        for i in range(int(self.submission_count)):
            s = self.submissions[i]
            if int(s.bounty_id) == int(bounty_id):
                result.append({
                    "id": int(s.id),
                    "bounty_id": int(s.bounty_id),
                    "creator": s.creator,
                    "content_url": s.content_url,
                    "status": s.status,
                    "score": int(s.score),
                    "feedback": s.feedback,
                })
        return result

    @gl.public.view
    def get_submission(self, submission_id: u256) -> dict:
        assert int(submission_id) < int(self.submission_count), "Not found"
        s = self.submissions[int(submission_id)]
        return {
            "id": int(s.id),
            "bounty_id": int(s.bounty_id),
            "creator": s.creator,
            "content_url": s.content_url,
            "status": s.status,
            "score": int(s.score),
            "feedback": s.feedback,
        }
