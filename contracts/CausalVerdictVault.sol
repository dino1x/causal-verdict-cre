// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal IERC165 + Chainlink CRE IReceiver surface (KeystoneForwarder calls onReport).
interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title CausalVerdictVault
/// @notice Append-only ledger of PRACTICE trade verdicts produced by the Causal-Verdict CRE workflow.
///         Each record binds the decision to (a) the hash of the compiled fiduciary mandate AST and
///         (b) the root of the hash-chained reasoning trace over real RYO-CHAN MCP evidence.
///         No funds are held or moved. Nothing here is an executed trade.
contract CausalVerdictVault is IReceiver {
    enum Decision { REJECT, SELECT }

    struct Verdict {
        bytes32 runId;
        string symbol;
        Decision decision;
        int256 entryE8;      // USD * 1e8
        int256 stopE8;
        int256 target1E8;
        int256 target2E8;
        uint16 sizeBps;      // position notional as basis points of practice equity
        uint16 confluenceBps;// RYO deep_analysis confluence * 10_000 (type(uint16).max = unavailable)
        uint32 failedGateMask; // bit i set => mandate clause C(i+1) failed
        bytes32 mandateHash;
        bytes32 evidenceRoot;
        uint64 observedAt;   // RYO as_of (unix seconds)
        uint64 recordedAt;   // block.timestamp
    }

    address public immutable forwarder;
    address public owner;
    bytes32 public activeMandateHash;

    Verdict[] private _verdicts;
    mapping(bytes32 => bool) public seenRun;

    event VerdictRecorded(
        uint256 indexed index,
        bytes32 indexed runId,
        string symbol,
        Decision decision,
        bytes32 mandateHash,
        bytes32 evidenceRoot,
        uint32 failedGateMask
    );
    event MandateActivated(bytes32 indexed mandateHash);

    error NotForwarder(address sender);
    error NotOwner();
    error MandateMismatch(bytes32 expected, bytes32 got);
    error DuplicateRun(bytes32 runId);
    error InvalidSelect();

    constructor(address forwarder_, bytes32 mandateHash_) {
        forwarder = forwarder_;
        owner = msg.sender;
        activeMandateHash = mandateHash_;
        emit MandateActivated(mandateHash_);
    }

    /// @notice A new mandate takes effect only by explicit owner action (the fiduciary amends the charter).
    function activateMandate(bytes32 mandateHash_) external {
        if (msg.sender != owner) revert NotOwner();
        activeMandateHash = mandateHash_;
        emit MandateActivated(mandateHash_);
    }

    /// @inheritdoc IReceiver
    function onReport(bytes calldata, bytes calldata report) external override {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);
        Verdict memory v = abi.decode(report, (Verdict));
        if (v.mandateHash != activeMandateHash) revert MandateMismatch(activeMandateHash, v.mandateHash);
        if (seenRun[v.runId]) revert DuplicateRun(v.runId);
        // A SELECT must be internally consistent: no failed gates, stop below entry, target above entry.
        if (v.decision == Decision.SELECT && (v.failedGateMask != 0 || v.stopE8 >= v.entryE8 || v.target1E8 <= v.entryE8)) {
            revert InvalidSelect();
        }
        v.recordedAt = uint64(block.timestamp);
        seenRun[v.runId] = true;
        _verdicts.push(v);
        emit VerdictRecorded(_verdicts.length - 1, v.runId, v.symbol, v.decision, v.mandateHash, v.evidenceRoot, v.failedGateMask);
    }

    function verdictCount() external view returns (uint256) {
        return _verdicts.length;
    }

    function verdict(uint256 i) external view returns (Verdict memory) {
        return _verdicts[i];
    }

    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
