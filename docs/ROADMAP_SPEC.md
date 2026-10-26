# Study Roadmap Specification

**Source of Truth:** `Readme.md` (Section 12: Learning Engine) & `BUILD_PLAYBOOK.md` (Phase 5B).

---

## 1. Core Principles: "Code Decides, the LLM Writes"

1. **Pure Deterministic Planning (`backend/app/learning/planner.py`):**
   - The schedule length, daily time bounds, topic sequence, and task counts are calculated purely in Python.
   - Zero LLM tokens are used to calculate times, dates, or sequences.

2. **Grounded Topic Sequencing:**
   - Topics come exclusively from the student's ingested course materials (`Topic` table).
   - Weak topics (mastery score $< 0.60$) are prioritized and scheduled earlier than strong topics.
   - Lower mastery score = higher urgency.

3. **Strict Time Budgeting:**
   - Daily minutes target: $\text{daily\_minutes} = \text{round}(\text{hours\_per\_day} \times 60)$.
   - Hard invariant: No individual day exceeds $\text{hours\_per\_day} \times 60$ minutes.
   - Hard invariant: Total planned minutes over all days $\le \text{goal\_days} \times \text{hours\_per\_day} \times 60$.

4. **Level-Based Pacing:**
   - **Beginner:**
     - Review / foundation allocation: ~30%.
     - Target task duration: 25–30 minutes per task.
   - **Intermediate:**
     - Review allocation: ~20%.
     - Target task duration: 35–45 minutes per task.
   - **Advanced:**
     - Review allocation: ~10%.
     - Target task duration: 45–60 minutes per task.

5. **Roadmap Re-planning (`replan_roadmap`):**
   - Preserves completed items: Any `RoadmapItem` marked `completed=True` remains immutable at its original day index.
   - Uncompleted days ($K+1 \dots \text{goal\_days}$) are re-planned by re-ranking remaining topics according to updated topic mastery scores from quiz attempts.
   - Newly mastered topics move to lighter review; struggling topics receive earlier reinforcement.

6. **Roadmap Node LLM Generation (`MODEL_FAST`):**
   - The LLM writes only wording: day title, 2–3 learning objectives, and task descriptions.
   - Validation ensures the LLM cannot change day numbers, assigned topics, task counts, or time allocations.
