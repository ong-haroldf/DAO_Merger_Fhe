pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract DAOMergerFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public providers;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    mapping(uint256 => bool) public batchClosed;
    mapping(uint256 => mapping(address => bool)) public hasSubmittedToBatch;

    struct DAOData {
        euint32 treasuryValue;
        euint32 memberCount;
        euint32 activeMemberCount;
        euint32 revenueLastQuarter;
        euint32 expensesLastQuarter;
    }

    struct BatchSubmission {
        DAOData daoA;
        DAOData daoB;
    }
    mapping(uint256 => BatchSubmission) public encryptedSubmissions;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event ContractPaused(address indexed account);
    event ContractUnpaused(address indexed account);
    event CooldownSecondsSet(uint256 oldCooldownSeconds, uint256 newCooldownSeconds);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event DataSubmitted(address indexed provider, uint256 indexed batchId);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint256 synergyScore);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchClosedOrInvalid();
    error AlreadySubmitted();
    error ReplayAttempt();
    error StateMismatch();
    error InvalidBatchId();
    error NotInitialized();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!providers[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor() {
        owner = msg.sender;
        _initIfNeeded();
        emit OwnershipTransferred(address(0), msg.sender);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        providers[provider] = true;
        emit ProviderAdded(provider);
    }

    function removeProvider(address provider) external onlyOwner {
        providers[provider] = false;
        emit ProviderRemoved(provider);
    }

    function setPaused(bool _paused) external onlyOwner {
        if (_paused != paused) {
            paused = _paused;
            if (_paused) {
                emit ContractPaused(msg.sender);
            } else {
                emit ContractUnpaused(msg.sender);
            }
        }
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldownSeconds = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsSet(oldCooldownSeconds, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        currentBatchId++;
        batchClosed[currentBatchId] = false;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch(uint256 batchId) external onlyOwner {
        if (batchId == 0 || batchId > currentBatchId || batchClosed[batchId]) revert InvalidBatchId();
        batchClosed[batchId] = true;
        emit BatchClosed(batchId);
    }

    function submitData(
        uint256 batchId,
        euint32 treasuryValueA,
        euint32 memberCountA,
        euint32 activeMemberCountA,
        euint32 revenueLastQuarterA,
        euint32 expensesLastQuarterA,
        euint32 treasuryValueB,
        euint32 memberCountB,
        euint32 activeMemberCountB,
        euint32 revenueLastQuarterB,
        euint32 expensesLastQuarterB
    ) external onlyProvider whenNotPaused {
        if (batchId == 0 || batchId > currentBatchId || batchClosed[batchId]) revert BatchClosedOrInvalid();
        if (hasSubmittedToBatch[batchId][msg.sender]) revert AlreadySubmitted();
        if (block.timestamp < lastSubmissionTime[msg.sender] + cooldownSeconds) revert CooldownActive();

        _initIfNeeded();

        encryptedSubmissions[batchId] = BatchSubmission({
            daoA: DAOData(treasuryValueA, memberCountA, activeMemberCountA, revenueLastQuarterA, expensesLastQuarterA),
            daoB: DAOData(treasuryValueB, memberCountB, activeMemberCountB, revenueLastQuarterB, expensesLastQuarterB)
        });
        hasSubmittedToBatch[batchId][msg.sender] = true;
        lastSubmissionTime[msg.sender] = block.timestamp;

        emit DataSubmitted(msg.sender, batchId);
    }

    function requestSynergyScoreCalculation(uint256 batchId) external onlyProvider whenNotPaused {
        if (batchId == 0 || batchId > currentBatchId || !batchClosed[batchId]) revert BatchClosedOrInvalid();
        if (block.timestamp < lastDecryptionRequestTime[msg.sender] + cooldownSeconds) revert CooldownActive();

        _initIfNeeded();
        if (!FHE.isInitialized()) revert NotInitialized();

        BatchSubmission storage submission = encryptedSubmissions[batchId];

        euint32 memory combinedTreasury = submission.daoA.treasuryValue.add(submission.daoB.treasuryValue);
        euint32 memory combinedRevenue = submission.daoA.revenueLastQuarter.add(submission.daoB.revenueLastQuarter);
        euint32 memory combinedExpenses = submission.daoA.expensesLastQuarter.add(submission.daoB.expensesLastQuarter);
        euint32 memory combinedActiveMembers = submission.daoA.activeMemberCount.add(submission.daoB.activeMemberCount);
        euint32 memory combinedMembers = submission.daoA.memberCount.add(submission.daoB.memberCount);

        euint32 memory revenuePerActiveMember = combinedRevenue.div(combinedActiveMembers);
        euint32 memory expensesPerMember = combinedExpenses.div(combinedMembers);

        euint32 memory synergyScore = revenuePerActiveMember.sub(expensesPerMember).add(combinedTreasury);

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(synergyScore);

        bytes32 stateHash = _hashCiphertexts(cts);
        uint256 requestId = FHE.requestDecryption(cts, this.myCallback.selector);

        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;

        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        DecryptionContext memory ctx = decryptionContexts[requestId];

        // Rebuild ciphertexts in the exact same order as in requestSynergyScoreCalculation
        BatchSubmission storage submission = encryptedSubmissions[ctx.batchId];
        euint32 memory combinedTreasury = submission.daoA.treasuryValue.add(submission.daoB.treasuryValue);
        euint32 memory combinedRevenue = submission.daoA.revenueLastQuarter.add(submission.daoB.revenueLastQuarter);
        euint32 memory combinedExpenses = submission.daoA.expensesLastQuarter.add(submission.daoB.expensesLastQuarter);
        euint32 memory combinedActiveMembers = submission.daoA.activeMemberCount.add(submission.daoB.activeMemberCount);
        euint32 memory combinedMembers = submission.daoA.memberCount.add(submission.daoB.memberCount);
        euint32 memory revenuePerActiveMember = combinedRevenue.div(combinedActiveMembers);
        euint32 memory expensesPerMember = combinedExpenses.div(combinedMembers);
        euint32 memory synergyScore = revenuePerActiveMember.sub(expensesPerMember).add(combinedTreasury);

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(synergyScore);

        bytes32 currentHash = _hashCiphertexts(cts);
        if (currentHash != ctx.stateHash) revert StateMismatch();

        FHE.checkSignatures(requestId, cleartexts, proof);

        uint256 clearSynergyScore = abi.decode(cleartexts, (uint256));
        decryptionContexts[requestId].processed = true;

        emit DecryptionCompleted(requestId, ctx.batchId, clearSynergyScore);
    }

    function _hashCiphertexts(bytes32[] memory cts) internal pure returns (bytes32) {
        return keccak256(abi.encode(cts, address(this)));
    }

    function _initIfNeeded() internal {
        if (!FHE.isInitialized()) {
            FHE.initialize(address(this), SepoliaConfig.getFHEKeyCreationParameters());
        }
    }

    function _requireInitialized() internal view {
        if (!FHE.isInitialized()) revert NotInitialized();
    }
}