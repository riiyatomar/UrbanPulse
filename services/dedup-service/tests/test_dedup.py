"""
Tests for core duplicate detection logic.
"""

from unittest.mock import patch, MagicMock
from app.services.dedup import dedup_service


def test_exact_match_detected(test_image_bytes, mock_db, mock_vector_store):
    """
    Test duplicate detection when similarity score is high (>= 0.92).
    """
    mock_vector_store.find_nearest_neighbors.return_value = [
        {
            "complaint_id": "matched-id-uuid-1",
            "similarity": 0.95,
            "status": "assigned",
        }
    ]

    with patch("app.services.dedup.vector_store", mock_vector_store), \
         patch("app.services.dedup.dedup_db", mock_db):

        is_duplicate, matched_id, score = dedup_service.check_duplicate(
            complaint_id="new-complaint-id",
            image_bytes=test_image_bytes,
            lat=28.6139,
            lng=77.2090,
        )

        assert is_duplicate is True
        assert matched_id == "matched-id-uuid-1"
        assert score == 0.95


def test_near_miss_below_threshold(test_image_bytes, mock_db, mock_vector_store):
    """
    Test duplicate detection when similarity is below threshold (0.92).
    """
    mock_vector_store.find_nearest_neighbors.return_value = [
        {
            "complaint_id": "matched-id-uuid-2",
            "similarity": 0.88,
            "status": "assigned",
        }
    ]

    with patch("app.services.dedup.vector_store", mock_vector_store), \
         patch("app.services.dedup.dedup_db", mock_db):

        is_duplicate, matched_id, score = dedup_service.check_duplicate(
            complaint_id="new-complaint-id",
            image_bytes=test_image_bytes,
            lat=28.6139,
            lng=77.2090,
        )

        assert is_duplicate is False
        assert matched_id is None


def test_no_match_case(test_image_bytes, mock_db, mock_vector_store):
    """
    Test when no nearest neighbors are returned.
    """
    mock_vector_store.find_nearest_neighbors.return_value = []

    with patch("app.services.dedup.vector_store", mock_vector_store), \
         patch("app.services.dedup.dedup_db", mock_db):

        is_duplicate, matched_id, score = dedup_service.check_duplicate(
            complaint_id="new-complaint-id",
            image_bytes=test_image_bytes,
            lat=28.6139,
            lng=77.2090,
        )

        assert is_duplicate is False
        assert matched_id is None


def test_duplicate_rejects_complaint(test_image_bytes, mock_db, mock_vector_store):
    """
    Verify that if duplicate is found, the database marks the new complaint as rejected.
    """
    mock_vector_store.find_nearest_neighbors.return_value = [
        {
            "complaint_id": "matched-id-uuid-1",
            "similarity": 0.95,
            "status": "assigned",
        }
    ]

    with patch("app.services.dedup.vector_store", mock_vector_store), \
         patch("app.services.dedup.dedup_db", mock_db):

        res = dedup_service.process_complaint_dedup(
            complaint_id="new-complaint-id",
            image_bytes=test_image_bytes,
            lat=28.6139,
            lng=77.2090,
        )

        assert res is True  # returns True indicating duplicate was resolved
        mock_db.reject_as_duplicate.assert_called_once_with("new-complaint-id", duplicate_of_id="matched-id-uuid-1")
        mock_db.insert_embedding.assert_not_called()


def test_unique_saves_embedding(test_image_bytes, mock_db, mock_vector_store):
    """
    Verify that if a complaint is unique, it inserts the embedding and returns False.
    """
    mock_vector_store.find_nearest_neighbors.return_value = []

    with patch("app.services.dedup.vector_store", mock_vector_store), \
         patch("app.services.dedup.dedup_db", mock_db):

        res = dedup_service.process_complaint_dedup(
            complaint_id="new-complaint-id",
            image_bytes=test_image_bytes,
            lat=28.6139,
            lng=77.2090,
        )

        assert res is False  # unique complaint
        mock_db.reject_as_duplicate.assert_not_called()
        mock_db.insert_embedding.assert_called_once()
        args, kwargs = mock_db.insert_embedding.call_args
        assert args[0] == "new-complaint-id"
        assert len(args[2]) == 7  # geohash precision


def test_embedding_computed_only_once_for_unique_complaint(test_image_bytes, mock_db, mock_vector_store):
    """
    Verify that compute_embedding is called exactly once (no redundant second inference pass).
    """
    mock_vector_store.find_nearest_neighbors.return_value = []

    with patch("app.services.dedup.vector_store", mock_vector_store), \
         patch("app.services.dedup.dedup_db", mock_db), \
         patch("app.services.dedup.embedding_service") as mock_emb:
        mock_emb.compute_embedding.return_value = [0.1] * 512

        res = dedup_service.process_complaint_dedup(
            complaint_id="new-complaint-id",
            image_bytes=test_image_bytes,
            lat=28.6139,
            lng=77.2090,
        )

        assert res is False
        assert mock_emb.compute_embedding.call_count == 1


def test_reused_embedding_passed_to_search_and_insert(test_image_bytes, mock_db, mock_vector_store):
    """
    Verify that the exact same embedding instance computed is passed to vector_store and insert_embedding.
    """
    mock_vector_store.find_nearest_neighbors.return_value = []
    fixed_vector = [0.042] * 512

    with patch("app.services.dedup.vector_store", mock_vector_store), \
         patch("app.services.dedup.dedup_db", mock_db), \
         patch("app.services.dedup.embedding_service") as mock_emb:
        mock_emb.compute_embedding.return_value = fixed_vector

        res = dedup_service.process_complaint_dedup(
            complaint_id="reuse-test-id",
            image_bytes=test_image_bytes,
            lat=28.6139,
            lng=77.2090,
        )

        assert res is False
        # Verify vector_store received fixed_vector
        vector_call_kwargs = mock_vector_store.find_nearest_neighbors.call_args.kwargs
        assert vector_call_kwargs["embedding"] == fixed_vector

        # Verify db insert received fixed_vector
        db_call_args = mock_db.insert_embedding.call_args[0]
        assert db_call_args[1] == fixed_vector


